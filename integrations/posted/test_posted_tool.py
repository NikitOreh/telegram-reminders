import asyncio
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace

from posted_tool import (load_config, private_directory, profile_lock, bind_identity,
                         screen_snapshot, account_command, error_message, UserFacingError)


class FakeClient:
    def __init__(self, authorized=True, premium=True, service_bot=True):
        self.authorized = authorized
        self.premium = premium
        self.service_bot = service_bot
        self.calls = []

    async def connect(self):
        self.calls.append('connect')

    async def disconnect(self):
        self.calls.append('disconnect')

    async def is_user_authorized(self):
        return self.authorized

    async def start(self, **kwargs):
        self.calls.append('login')
        self.authorized = True

    async def get_me(self):
        return SimpleNamespace(id=123, premium=self.premium, bot=False)

    async def get_entity(self, username):
        self.calls.append(('resolve', username))
        return SimpleNamespace(id=456, username=username, bot=self.service_bot)

    async def get_messages(self, service, limit):
        self.calls.append(('history', service.id, limit))
        return [SimpleNamespace(out=True, message='private outgoing post'),
                SimpleNamespace(out=False, id=15, message='Выберите канал', reply_markup=None)]


class PostedToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.directory = private_directory(self.root, 'test')
        self.config = {'api_id': 12345, 'api_hash': 'a' * 32, 'profile': 'test', 'username': 'posted'}

    def tearDown(self):
        self.temp.cleanup()

    def test_config_has_scoped_profile_and_never_uses_bot_token(self):
        path = self.root / '.env'
        path.write_text('TELEGRAM_API_ID=12345\nTELEGRAM_API_HASH=' + 'a' * 32 + '\nPOSTED_PROFILE=test\nPOSTED_USERNAME=@posted\n', encoding='utf-8')
        self.assertEqual(load_config(path), self.config)

    def test_config_rejects_path_traversal_wrong_target_and_duplicate_keys(self):
        path = self.root / '.env'
        for suffix in ['POSTED_PROFILE=../../other', 'POSTED_USERNAME=untrusted_bot', 'TELEGRAM_API_ID=54321']:
            path.write_text('TELEGRAM_API_ID=12345\nTELEGRAM_API_HASH=' + 'a' * 32 + '\n' + suffix, encoding='utf-8')
            with self.assertRaises(UserFacingError):
                load_config(path)
        with self.assertRaises(UserFacingError):
            private_directory(self.root, '../other')

    def test_os_lock_blocks_second_client_and_is_released(self):
        with profile_lock(self.directory):
            with self.assertRaises(UserFacingError):
                with profile_lock(self.directory):
                    pass
        with profile_lock(self.directory):
            pass

    def test_account_and_provider_are_pinned_to_profile(self):
        bind_identity(self.directory, 123, 456)
        bind_identity(self.directory, 123, 456)
        for user, provider in [(999, 456), (123, 999)]:
            with self.assertRaises(UserFacingError):
                bind_identity(self.directory, user, provider)
        self.assertEqual(json.loads((self.directory / 'connection.json').read_text()), {'user_id': 123, 'service_id': 456})

    def test_check_does_not_start_login_or_read_messages(self):
        client = FakeClient()
        result = asyncio.run(account_command('check', self.config, self.directory, lambda *args, **kwargs: client))
        self.assertTrue(result['premium'])
        self.assertEqual(client.calls, ['connect', ('resolve', 'posted'), 'disconnect'])
        self.assertNotIn('api_hash', json.dumps(result))

    def test_check_without_session_never_prompts_or_logs_in(self):
        client = FakeClient(authorized=False)
        with self.assertRaisesRegex(UserFacingError, 'posted:login'):
            asyncio.run(account_command('check', self.config, self.directory, lambda *args, **kwargs: client))
        self.assertEqual(client.calls, ['connect', 'disconnect'])

    def test_only_explicit_login_command_can_authenticate(self):
        client = FakeClient(authorized=False)
        with contextlib.redirect_stdout(io.StringIO()):
            asyncio.run(account_command('login', self.config, self.directory, lambda *args, **kwargs: client))
        self.assertIn('login', client.calls)
        self.assertEqual(client.calls[-1], 'disconnect')

    def test_non_premium_and_non_bot_target_are_rejected(self):
        for client in [FakeClient(premium=False), FakeClient(service_bot=False)]:
            with self.assertRaises(UserFacingError):
                asyncio.run(account_command('check', self.config, self.directory, lambda *args, **kwargs: client))
            self.assertEqual(client.calls[-1], 'disconnect')

    def test_active_collectible_service_alias_is_accepted_and_id_is_pinned(self):
        class AliasClient(FakeClient):
            async def get_entity(self, username):
                return SimpleNamespace(id=456, username='posted_emoji_bot', bot=True,
                                       usernames=[SimpleNamespace(username='posted', active=True)])
        result = asyncio.run(account_command('check', self.config, self.directory, lambda *args, **kwargs: AliasClient()))
        self.assertEqual(result['service'], '@posted')

    def test_inspection_reads_only_posted_and_excludes_outgoing_private_posts(self):
        client = FakeClient()
        result = asyncio.run(account_command('inspect', self.config, self.directory, lambda *args, **kwargs: client))
        screen = json.loads((self.directory / 'posted-screen.json').read_text(encoding='utf-8'))
        self.assertEqual(screen['text'], 'Выберите канал')
        self.assertNotIn('private outgoing post', json.dumps(result))
        self.assertEqual(client.calls, ['connect', ('resolve', 'posted'), ('history', 456, 12), 'disconnect'])

    def test_screen_report_never_contains_callback_payloads(self):
        button = SimpleNamespace(text='Меню', data=b'secret-callback', url='https://example.com/private')
        message = SimpleNamespace(id=1, message='test', rich_message=None,
                                  reply_markup=SimpleNamespace(rows=[SimpleNamespace(buttons=[button])]))
        encoded = json.dumps(screen_snapshot(message))
        self.assertNotIn('callback', encoded)
        self.assertNotIn('private', encoded)
        self.assertIn('SimpleNamespace', encoded)

    def test_untrusted_errors_do_not_echo_authorization_data(self):
        for error in [RuntimeError('secret session'), ValueError('private phone'), OSError('private path')]:
            self.assertNotIn('secret', error_message(error))
            self.assertNotIn('private', error_message(error))
        self.assertEqual(error_message(UserFacingError('Заполните настройки')), 'Заполните настройки')


if __name__ == '__main__':
    unittest.main()
