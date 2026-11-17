"""Stage 1: account authorization and read-only inspection. No posting or button clicks."""
import argparse
import asyncio
import contextlib
import getpass
import importlib.metadata
import json
import logging
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.posted-deps'))


class UserFacingError(ValueError):
    pass


def load_config(filename):
    path = pathlib.Path(filename)
    if not path.exists():
        raise UserFacingError('Создайте integrations/posted/.env по образцу .env.example и заполните API ID и API hash.')
    values = {}
    for raw in path.read_text(encoding='utf-8-sig').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'(?:export\s+)?([A-Z_]+)\s*=\s*(.*)', line)
        if not match:
            raise UserFacingError('Неверный формат файла настроек Posted.')
        key, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key in values:
            raise UserFacingError('В файле настроек есть повторяющиеся параметры.')
        values[key] = value
    api_id = values.get('TELEGRAM_API_ID', '')
    api_hash = values.get('TELEGRAM_API_HASH', '')
    profile = values.get('POSTED_PROFILE', 'owner')
    username = values.get('POSTED_USERNAME', 'posted').removeprefix('@').lower()
    if not api_id.isascii() or not api_id.isdigit() or not 0 < int(api_id) <= 2147483647:
        raise UserFacingError('Заполните TELEGRAM_API_ID числом из my.telegram.org.')
    if not re.fullmatch(r'[a-fA-F0-9]{32}', api_hash):
        raise UserFacingError('Заполните TELEGRAM_API_HASH из my.telegram.org.')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', profile):
        raise UserFacingError('POSTED_PROFILE: только буквы, цифры, дефис и подчёркивание.')
    if username != 'posted':
        raise UserFacingError('Первый адаптер проверяется только с @posted.')
    return {'api_id': int(api_id), 'api_hash': api_hash, 'profile': profile, 'username': username}


def private_directory(root, profile):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', profile):
        raise UserFacingError('Некорректный профиль.')
    root = pathlib.Path(root)
    directory = root / 'private' / 'posted' / profile
    if any(item.is_symlink() for item in (root / 'private', root / 'private' / 'posted', directory)):
        raise UserFacingError('Папка профиля не должна быть символической ссылкой.')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for item in (root / 'private', root / 'private' / 'posted', directory):
        item.chmod(0o700)
    return directory


@contextlib.contextmanager
def profile_lock(directory):
    # OS locks are released on exit/crash; profiles never share a Telegram session.
    handle = (pathlib.Path(directory) / 'client.lock').open('a+b')
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b'0')
        handle.flush()
    handle.seek(0)
    acquired = False
    try:
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except OSError:
            raise UserFacingError('Этот профиль уже открыт другим процессом.') from None
        yield
    finally:
        if acquired:
            if os.name == 'nt':
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def write_private_json(path, data):
    path = pathlib.Path(path)
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w', encoding='utf-8') as output:
        temp.chmod(0o600)
        json.dump(data, output, ensure_ascii=False, indent=2)
    os.replace(temp, path)


def bind_identity(directory, user_id, service_id):
    path = pathlib.Path(directory) / 'connection.json'
    expected = {'user_id': int(user_id), 'service_id': int(service_id)}
    if path.exists() and json.loads(path.read_text(encoding='utf-8')) != expected:
        raise UserFacingError('Аккаунт или сервис не совпадает с ранее подключённым профилем. Создайте другой профиль.')
    write_private_json(path, expected)


def screen_snapshot(message):
    markup = getattr(message, 'reply_markup', None)
    buttons = [[{'text': button.text, 'type': type(button).__name__}
                for button in row.buttons] for row in getattr(markup, 'rows', [])]
    return {'message_id': message.id, 'text': getattr(message, 'message', '') or '',
            'buttons': buttons, 'has_rich_message': bool(getattr(message, 'rich_message', None))}


def schema_report():
    from telethon.tl import types, alltlobjects
    return {'library': 'Telethon', 'version': importlib.metadata.version('Telethon'),
            'layer': alltlobjects.LAYER, 'rich_message': hasattr(types, 'RichMessage'),
            'custom_emoji': hasattr(types, 'MessageEntityCustomEmoji')}


async def inspect_menu(client, service, directory):
    messages = await client.get_messages(service, limit=12)
    incoming = [message for message in messages if not message.out]
    if not incoming:
        raise UserFacingError('В личном диалоге с @posted нет ответа. Откройте его этим аккаунтом и нажмите /start.')
    # A private report is available locally for developing the adapter. No API keys,
    # session data, callback payloads, or personal message history go to stdout.
    screen = screen_snapshot(incoming[0])
    write_private_json(pathlib.Path(directory) / 'posted-screen.json', screen)
    return {'message_id': screen['message_id'], 'buttons': screen['buttons'],
            'has_rich_message': screen['has_rich_message'], 'report': 'posted-screen.json'}


async def account_command(command, config, directory, client_factory=None, secret_input=getpass.getpass):
    if client_factory is None:
        from telethon import TelegramClient
        client_factory = TelegramClient
    logger = logging.getLogger('posted-client')
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    logger.setLevel(logging.CRITICAL)
    client = client_factory(str(directory / 'account.session'), config['api_id'], config['api_hash'],
                            base_logger=logger, request_retries=1, connection_retries=1,
                            flood_sleep_threshold=0, device_model='Reminders Posted Connector', app_version='0.1')
    try:
        await client.connect()
        if not await client.is_user_authorized():
            if command != 'login':
                raise UserFacingError('Аккаунт не подключён. Сначала выполните npm run posted:login.')
            print('Входите в отдельный Premium-аккаунт. Номер, код и пароль вводятся скрыто в этом терминале.')
            await client.start(phone=lambda: secret_input('Номер телефона: '),
                               code_callback=lambda: secret_input('Код Telegram: '),
                               password=lambda: secret_input('Пароль двухэтапной проверки: '))
        user = await client.get_me()
        if not user or getattr(user, 'bot', False) or not getattr(user, 'premium', False):
            raise UserFacingError('Нужен пользовательский аккаунт с активным Telegram Premium. Для другого аккаунта задайте новый POSTED_PROFILE.')
        service = await client.get_entity(config['username'])
        names = {(getattr(service, 'username', '') or '').lower()}
        names.update((getattr(alias, 'username', '') or '').lower()
                     for alias in getattr(service, 'usernames', None) or [] if getattr(alias, 'active', False))
        if not getattr(service, 'bot', False) or config['username'] not in names:
            raise UserFacingError('Не удалось подтвердить бота @posted.')
        bind_identity(directory, user.id, service.id)
        result = {'profile': config['profile'], 'premium': True, 'service': '@' + config['username']}
        if command == 'inspect':
            result['screen'] = await inspect_menu(client, service, directory)
        return result
    finally:
        await client.disconnect()
        for path in directory.glob('account.session*'):
            path.chmod(0o600)


def error_message(error):
    if isinstance(error, UserFacingError):
        return str(error)
    name = type(error).__name__
    messages = {'ApiIdInvalidError': 'Telegram отклонил API ID или API hash.',
                'PhoneCodeInvalidError': 'Код Telegram неверен. Повторите вход.',
                'PhoneCodeExpiredError': 'Код Telegram истёк. Повторите вход.',
                'PasswordHashInvalidError': 'Пароль двухэтапной проверки неверен.',
                'AuthKeyUnregisteredError': 'Авторизация отозвана. Повторите вход.',
                'ModuleNotFoundError': 'Сначала выполните npm run posted:setup.'}
    if name == 'FloodWaitError':
        return 'Telegram попросил подождать. Повторите подключение позже.'
    return messages.get(name, 'Подключение не выполнено (' + name + '). Данные авторизации не выводятся.')


def main():
    parser = argparse.ArgumentParser(description='Подключение Premium-аккаунта для проверки @posted. Не публикует посты.')
    parser.add_argument('command', choices=['login', 'check', 'inspect', 'schema'])
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == 'schema':
            result = schema_report()
        else:
            config = load_config(HERE / '.env')
            directory = private_directory(ROOT, config['profile'])
            with profile_lock(directory):
                result = asyncio.run(account_command(args.command, config, directory))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        print('Подключение отменено.', file=sys.stderr)
        return 130
    except Exception as error:
        print(error_message(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
