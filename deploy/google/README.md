# Перенос Telegram-бота в Google Cloud

Бот получает сообщения через long polling и сам ведёт очередь публикаций. Ему нужна одна постоянно работающая Linux-ВМ. Домен, веб-сервер и входящий HTTP-порт не нужны. **Не запускайте одновременно Windows- и облачную копии с одним токеном**: это вызовет конфликт Telegram polling и расхождение `data.json`.

## 1. Создайте проект и настройте оплату

1. Войдите в [Google Cloud Console](https://console.cloud.google.com/). Если Google Cloud предложит бесплатный пробный период, завершите регистрацию и привяжите платёжный аккаунт. Наличие обычного аккаунта Google само по себе не создаёт проект или биллинг.
2. Откройте [Управление ресурсами](https://console.cloud.google.com/cloud-resource-manager), нажмите **Создать проект**, назовите его, например, `telegram-reminders`, и выберите доступный платёжный аккаунт. Затем выберите созданный проект в верхней панели.
3. Откройте **Billing → Budgets & alerts**, создайте месячный бюджет с уведомлениями на нужную вам сумму. Обычный бюджет **уведомляет, но не ограничивает расходы автоматически**. Проверяйте текущую оценку стоимости в консоли до создания ВМ.

## 2. Создайте ВМ

Откройте [Compute Engine → VM instances](https://console.cloud.google.com/compute/instances), включите API, если появится запрос, и нажмите **Create instance**:

| Настройка | Значение для первого запуска |
| --- | --- |
| Имя | `telegram-reminders` |
| Регион / зона | `us-central1` / доступная зона внутри региона |
| Серия / тип | E2 / `e2-micro`, обычная ВМ, **без Spot** |
| Образ | Ubuntu 24.04 LTS, x86_64 |
| Загрузочный диск | `pd-standard`, 30 GB или меньше |
| Публичный IPv4 | Ephemeral external IP для начального SSH-подключения |
| Firewall | HTTP и HTTPS снаружи не открывать; нужен только SSH (TCP 22) |

`e2-micro` в указанном регионе подпадает под бесплатный лимит Compute Engine, но 1 ГБ RAM может не хватить на интенсивный поиск фотографий и установку зависимостей. Установите swap, как указано ниже, и наблюдайте за памятью. Если появятся OOM-сбои, увеличьте ВМ до `e2-small` (он платный). Публичный IPv4 и исходящий трафик могут оплачиваться отдельно даже при бесплатной ВМ. Перед созданием смотрите оценку в консоли.

После создания запишите **External IP** ВМ. Если после остановки ВМ он изменится, используйте новый IP. Бот получает данные исходящими соединениями и от смены IP не зависит.

## 3. Настройте SSH из Windows

В PowerShell один раз создайте отдельный ключ:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\telegram-reminders-gcp" -C "reminderadmin"
Get-Content "$env:USERPROFILE\.ssh\telegram-reminders-gcp.pub"
```

Скопируйте **только строку открытого ключа** из файла `.pub`. На странице ВМ откройте её параметры, раздел **SSH keys**, нажмите **Add item**, вставьте ключ и сохраните. Убедитесь, что OS Login не включён: при OS Login ключи из метаданных ВМ не действуют. Закрытый ключ (файл без `.pub`) не загружайте. Имя пользователя из команды выше — `reminderadmin`.

Проверьте подключение (подставьте внешний IP):

```powershell
ssh -i "$env:USERPROFILE\.ssh\telegram-reminders-gcp" reminderadmin@ВНЕШНИЙ_IP
```

Если SSH не работает, проверьте правило входящего TCP 22 для ВМ и ключ в её метаданных. Выход из SSH: `exit`.

## 4. Подготовьте сервер, пока Windows-бот работает

На ВМ через SSH создайте swap для `e2-micro`:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

На **Windows** откройте PowerShell в папке `telegram-reminders` и соберите архив. Он включает исходный код, `data.json`, `.env`, модели распознавания людей и локальный кэш изображений. Windows-зависимости не копируются; они будут установлены для Linux. Ключ OpenAI из `.env` исключается.

```powershell
$archive = Join-Path $env:TEMP "telegram-reminders-stage-$(Get-Date -Format yyyyMMdd-HHmmss).tar.gz"
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\yandex\package.ps1 -OutputPath $archive
scp -i "$env:USERPROFILE\.ssh\telegram-reminders-gcp" $archive reminderadmin@ВНЕШНИЙ_IP:~/telegram-reminders.tar.gz
```

Архив содержит токен Telegram и приватное состояние бота. Не загружайте его в GitHub или публичное хранилище.

На **ВМ** выполните:

```bash
mkdir -p ~/telegram-reminders-stage
tar -xzf ~/telegram-reminders.tar.gz -C ~/telegram-reminders-stage
sudo bash ~/telegram-reminders-stage/deploy/yandex/install.sh ~/telegram-reminders-stage
```

Название `deploy/yandex/install.sh` осталось от первоначального развёртывания; это обычный установщик Ubuntu, пригодный для Google Compute Engine. Он ставит Node.js 22, npm-пакеты, Python-зависимости для проверки фотографий, проверяет Telegram и каналы, создаёт `systemd`-службу и резервное копирование. **Служба бота пока не запускается**, поэтому действующий Windows-бот продолжает работать.

## 5. Переключите бота без потери очереди

Выберите время без ближайших публикаций. Остановите **именно процесс Windows-бота**; не создавайте второй локальный экземпляр. После полной остановки повторите на Windows сборку и передачу архива из шага 4, используя новое имя локального файла. Это перенесёт актуальные `data.json`, очередь и Telegram offset. На ВМ удалите старую папку распаковки, распакуйте новый архив и повторите установку:

```bash
rm -rf -- ~/telegram-reminders-stage
mkdir -p ~/telegram-reminders-stage
tar -xzf ~/telegram-reminders.tar.gz -C ~/telegram-reminders-stage
sudo bash ~/telegram-reminders-stage/deploy/yandex/install.sh ~/telegram-reminders-stage
sudo systemctl enable --now telegram-reminders
sudo systemctl status telegram-reminders --no-pager
sudo journalctl -u telegram-reminders -n 40 --no-pager
```

Проверьте ответ на `/start`, контент-план и тестовую публикацию. Убедитесь, что следующая запланированная отправка произошла в нужное московское время. Для просмотра логов впоследствии:

```bash
sudo journalctl -u telegram-reminders -f
```

При неудаче остановите службу `sudo systemctl disable --now telegram-reminders`, восстановите последнюю сохранённую копию `data.json` и только после этого запускайте Windows-бота. Не запускайте обе копии одновременно.

## 6. Уберите секретные архивы и следите за работой

После проверки удалите архивы с Windows и ВМ. На ВМ:

```bash
rm -f -- ~/telegram-reminders.tar.gz
rm -rf -- ~/telegram-reminders-stage
systemctl list-timers telegram-reminders-backup.timer
df -h /opt/telegram-reminders
free -h
```

`systemd` запускает бота после перезагрузки и перезапускает его после сбоя. Резервные копии `data.json` создаются каждые шесть часов в `/var/backups/telegram-reminders` и хранятся 14 дней **на том же диске**. От удаления ВМ они не защищают; настройте снимки диска или внешнее резервное копирование, если работа уже стала критичной.

Официальные материалы: [создание проекта](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects), [создание ВМ](https://docs.cloud.google.com/compute/docs/instances/create-start-instance), [бесплатный лимит Compute Engine](https://docs.cloud.google.com/free/docs/free-cloud-features), [SSH-ключи](https://docs.cloud.google.com/compute/docs/connect/add-ssh-keys), [бюджеты](https://docs.cloud.google.com/billing/docs/how-to/budgets).
