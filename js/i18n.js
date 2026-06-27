(function(){
  const pairs = [
    ['Макс. мс','Max ms'],['мс','ms'],['Укажи максимум Y от 0 до 1000000','Enter a Y maximum from 0 to 1000000'],['Настройки сохранены','Settings saved'],['Если менял порт — перезапусти программу через RUN.cmd.','If you changed the port, restart the program using RUN.cmd.'],
    ['Следит за системой, пока ты спишь.','Keeps an eye on your system while you sleep.'],
    ['О программе MoonFox monitor','About MoonFox monitor'],
    ['🏠 Обзор','🏠 Overview'],['🌐 Сайты','🌐 Sites'],['🖧 Устройства','🖧 Devices'],['📈 Графики','📈 Charts'],['🔔 События','🔔 Events'],['⚙️ Настройки','⚙️ Settings'],
    ['Обзор','Overview'],['Сайты','Sites'],['Устройства','Devices'],['Графики','Charts'],['События','Events'],['Настройки','Settings'],
    ['Система работает','System is running'],['Последняя проверка','Last check'],['Аптайм','Uptime'],['Версия 0.6.5','Version 0.6.5'],
    ['Общая панель состояния мониторинга','Monitoring status dashboard'],
    ['Редактирование и проверка сайтов','Manage and check websites'],
    ['Ping-проверка роутеров, серверов, NAS, ПК и IP-узлов','Ping checks for routers, servers, NAS, PCs and IP nodes'],
    ['Отдельные окна графиков мониторинга','Custom monitoring charts'],
    ['История последних проверок','Recent check history'],
    ['Название, внешний вид, проверки и уведомления','Appearance, checks and notifications'],
    ['Обновление экрана:','Screen refresh:'],['Обновление экрана','Screen refresh'],['Выкл','Off'],['Своё значение...','Custom value...'],['Обновить данные','Refresh data'],
    ['Сайтов','Sites'],['Устройств','Devices'],['Доступность','Availability'],['Проблем','Issues'],['Последняя проблема','Last issue'],
    ['Средний отклик','Average response'],['Последнее обновление','Last update'],['Уведомления','Notifications'],['Активных','Active'],
    ['По сайтам','Websites'],['Нет','None'],['Нет проблем','No issues'],
    ['Последние проверки сайтов','Recent website checks'],['Статус устройств','Device status'],
    ['Перейти к сайтам →','Go to sites →'],['Перейти к устройствам →','Go to devices →'],['Перейти к графикам →','Go to charts →'],
    ['Мониторинг сайтов','Website monitoring'],['Мониторинг устройств','Device monitoring'],['Вид','Style'],['Интервал','Interval'],['сек','sec'],
    ['Линия','Line'],['Столбцы','Bars'],['Круговая','Pie'],
    ['События сайтов','Website events'],['События устройств','Device events'],['Все события →','All events →'],
    ['Топ сайтов по времени ответа','Websites by response time'],['Топ устройств по ping','Devices by ping'],
    ['Введите название, адрес сайта и выберите цвет линии для графика.','Enter a name, website address and chart color.'],
    ['Название, например: Мой сайт','Name, for example: My website'],['URL, например: https://site.ru','URL, for example: https://example.com'],
    ['Цвет линии графика','Chart line color'],['Добавить сайт','Add site'],
    ['Добавь роутер, сервер, NAS, ПК или любой IP-узел. Порт необязательный: нужен для проверки службы, например 22, 80, 443, 3389.','Add a router, server, NAS, PC or any IP node. A port is optional and can be used to check a service such as 22, 80, 443 or 3389.'],
    ['Название, например: MikroTik, VPS, NAS','Name, for example: MikroTik, VPS, NAS'],['IP или адрес, например: 192.168.1.1','IP or address, for example: 192.168.1.1'],
    ['Например: MikroTik, VPS, NAS','For example: MikroTik, VPS, NAS'],['Например: 192.168.1.1','For example: 192.168.1.1'],
    ['Порт, необязательно','Port, optional'],['Порты, необязательно','Ports, optional'],['Порты: 22, 80, 443','Ports: 22, 80, 443'],['Например: 22, 80, 443','For example: 22, 80, 443'],
    ['Тип проверки','Check type'],['TCP-порт','TCP port'],['TCP-порты','TCP ports'],['Добавить устройство','Add device'],
    ['Добавь роутер, сервер, NAS, ПК или любой IP-узел. Можно указать несколько портов через запятую, например 22, 80, 443.','Add a router, server, NAS, PC or any IP node. You can specify multiple comma-separated ports, for example 22, 80, 443.'],
    ['+ Добавить график','+ Add chart'],['Последний час','Last hour'],['Последние 2 часа','Last 2 hours'],['Последние 6 часов','Last 6 hours'],
    ['Последние 24 часа','Last 24 hours'],['Последняя неделя','Last week'],['Все','All'],['Только важные','Important only'],
    ['Ошибки','Errors'],['Предупреждения','Warnings'],['Восстановления','Recoveries'],['Инфо','Info'],['Очистить события','Clear events'],
    ['Оформление','Appearance'],['Тема интерфейса','Interface theme'],['Тёмная','Dark'],['Светлая','Light'],['Фиолетовая','Purple'],['Синяя','Blue'],['Зелёная','Green'],['Пользовательская','Custom'],
    ['Масштаб интерфейса','Interface scale'],['Основной цвет','Accent color'],['Цвет кнопок','Button color'],['Цвет успеха','Success color'],['Цвет ошибки','Error color'],
    ['Фон приложения','Application background'],['Фон карточек','Card background'],
    ['Готовые темы применяются сразу. Цвета используются для пользовательской темы.','Preset themes are applied immediately. Colors are used by the custom theme.'],
    ['Веб-интерфейс','Web interface'],['Порт программы','Application port'],['Проверить','Check'],['Адрес после запуска:','Address after launch:'],
    ['После смены порта перезапусти программу через RUN.cmd.','Restart the application using RUN.cmd after changing the port.'],
    ['Мониторинг','Monitoring'],['Интервал проверки сайтов, сек','Website check interval, sec'],['Интервал проверки устройств, сек','Device check interval, sec'],
    ['Таймаут сайта, сек','Website timeout, sec'],['Подтверждать проблему после проверок подряд','Confirm an issue after consecutive failed checks'],
    ['Предупреждение от, мс','Warning from, ms'],['Критично от, мс','Critical from, ms'],
    ['Статусы: 🟢 доступен, 🟡 медленно, 🔴 недоступен/критично.','Statuses: 🟢 available, 🟡 slow, 🔴 unavailable/critical.'],
    ['Уведомления Telegram','Telegram notifications'],['Включить Telegram-уведомления','Enable Telegram notifications'],['Введите токен бота','Enter bot token'],['Введите chat ID','Enter chat ID'],
    ['Недоступен','Unavailable'],['Недоступно','Unavailable'],['Медленный ответ','Slow response'],['Высокий ping','High ping'],['Восстановлен','Recovered'],['Восстановлено','Recovered'],
    ['Повторять ошибки каждые, минут','Repeat errors every, minutes'],['0 — не повторять. Восстановление отправляется один раз.','0 means do not repeat. Recovery is sent once.'],
    ['Недоступность','Unavailability'],['Медленный ответ / высокий ping','Slow response / high ping'],['Восстановление','Recovery'],
    ['Отправить тест в Telegram','Send Telegram test'],['Сбросить тексты','Reset texts'],
    ['Ошибки повторяются по выбранной частоте. Восстановление приходит один раз.','Errors repeat at the selected frequency. Recovery is sent once.'],
    ['Дополнительно','Additional'],['Язык интерфейса','Interface language'],['Русский','Russian'],['Масштаб текста','Text scale'],
    ['Показывать миллисекунды','Show milliseconds'],['Открывать браузер при запуске','Open browser on launch'],
    ['Данные','Data'],['База лежит в','The database is stored in'],['Экспорт конфигурации','Export configuration'],['Импорт конфигурации','Import configuration'],
    ['Очистить историю графиков','Clear chart history'],['Удалить всё','Delete everything'],['Сохранить настройки','Save settings'],
    ['Редактировать сайт','Edit site'],['Название сайта','Website name'],['URL сайта','Website URL'],['Например: Мой сайт','For example: My website'],
    ['Например: https://site.ru','For example: https://example.com'],['Отмена','Cancel'],['Сохранить','Save'],
    ['Редактировать устройство','Edit device'],['Название устройства','Device name'],['IP или адрес','IP or address'],['Например: 443','For example: 443'],
    ['Добавить график','Add chart'],['Редактировать график','Edit chart'],['Название графика','Chart name'],['Например: Пинг сервера','For example: Server ping'],
    ['Что показывать','Metric'],['Время ответа сайтов','Website response time'],['Доступность сайтов','Website availability'],['Пинг устройств','Device ping'],
    ['Коды ответа сайтов','Website response codes'],['Ошибки сайтов','Website errors'],['Вид графика','Chart style'],['Высота окна','Chart height'],
    ['Компактный','Compact'],['Обычный','Standard'],['Большой','Large'],['Комментарий / описание','Comment / description'],
    ['Например: Основной график по сайтам','For example: Main website chart'],
    ['После добавления сайта или устройства нажми кнопку ⟳, чтобы появились данные на графике.','After adding a website or device, click ⟳ to collect chart data.'],
    ['Интервал автообновления','Refresh interval'],['Секунд','Seconds'],['Например: 45','For example: 45'],['Минимум 5 секунд, максимум 3600 секунд.','Minimum 5 seconds, maximum 3600 seconds.'],
    ['Логотип MoonFox monitor','MoonFox monitor logo'],['Разработчик:','Developer:'],['Закрыть','Close'],
    ['Название','Name'],['Адрес','Address'],['Статус','Status'],['Код','Code'],['Ответ','Response'],['Проверка','Check'],['Действия','Actions'],
    ['Последний сбой','Last failure'],['Порт','Port'],['Порты','Ports'],['Редактировать','Edit'],['Удалить','Delete'],['Диагностика','Diagnostics'],
    ['Доступен','Available'],['Медленно','Slow'],['Ожидает проверки','Waiting for check'],['Открыт','Open'],['Закрыт','Closed'],
    ['🟢 Доступен','🟢 Available'],['🟡 Медленно','🟡 Slow'],['🔴 Недоступен','🔴 Unavailable'],['🟢 Открыт','🟢 Open'],['🔴 Закрыт','🔴 Closed'],
    ['Никогда','Never'],['Ошибка','Error'],['Предупреждение','Warning'],['Восстановлено','Recovered'],
    ['Событий нет.','No events.'],['Событий за выбранный период нет.','No events in the selected period.'],
    ['Пока нет данных по устройствам.','No device data yet.'],['Пока нет данных по сайтам. Нажми ⟳ после добавления сайтов.','No website data yet. Click ⟳ after adding websites.'],
    ['Активных уведомлений нет.','No active notifications.'],['Нет объектов','No objects'],['HTTP-код','HTTP code'],
    ['Нет данных для круговой диаграммы.','No data for the pie chart.'],['последние значения','latest values'],
    ['Нет данных. Нажми «⟳» после добавления объектов.','No data. Click “⟳” after adding objects.'],['Время','Time'],
    ['Сайт недоступен','Website is unavailable'],['Сайт отвечает медленно','Website is responding slowly'],['Сайт снова доступен','Website is available again'],
    ['Устройство недоступно','Device is unavailable'],['Устройство снова доступно','Device is available again'],
    ['Заполни название и URL сайта','Enter the website name and URL'],['Удалить сайт?','Delete this website?'],
    ['Заполни название и IP/адрес','Enter the device name and IP/address'],['Порт должен быть от 1 до 65535','Port must be between 1 and 65535'],
    ['Для проверки TCP укажи порт','Specify a port for a TCP check'],['Удалить устройство?','Delete this device?'],
    ['Порт должен быть от 1024 до 65535','Port must be between 1024 and 65535'],['Интервалы проверки должны быть не меньше 1 секунды','Check intervals must be at least 1 second'],
    ['Для сайтов критичный порог должен быть больше предупреждения','The critical website threshold must be higher than the warning threshold'],
    ['Для устройств критичный порог должен быть больше предупреждения','The critical device threshold must be higher than the warning threshold'],
    ['Настройки сохранены. Если менял порт — перезапусти программу через RUN.cmd.','Settings saved. Restart the application using RUN.cmd if you changed the port.'],
    ['Сбросить тексты Telegram к стандартным?','Reset Telegram messages to their defaults?'],['Тестовое сообщение отправлено в Telegram.','The test message was sent to Telegram.'],['Telegram-уведомления выключены.','Telegram notifications are disabled.'],
    ['проверь токен и chat ID','check the token and chat ID'],['Очистить журнал событий?','Clear the event log?'],
    ['Напиши название графика','Enter a chart name'],['Удалить график?','Delete this chart?'],
    ['Удалить все сайты, устройства, графики, события и историю? Настройки программы останутся.','Delete all websites, devices, charts, events and history? Application settings will remain.'],
    ['Точно удалить все данные мониторинга? Это действие нельзя отменить.','Are you sure you want to delete all monitoring data? This cannot be undone.'],
    ['Все данные мониторинга удалены.','All monitoring data has been deleted.'],['Укажи интервал от 5 до 3600 секунд','Enter an interval from 5 to 3600 seconds'],
    ['Укажи интервал от 1 до 86400 секунд','Enter an interval from 1 to 86400 seconds'],['Очистить историю графиков и события?','Clear chart history and events?'],
    ['Файл не похож на JSON-конфигурацию','The file is not a valid JSON configuration'],
    ['Импортировать конфигурацию? Текущие сайты, устройства, графики и история будут заменены.','Import this configuration? Current websites, devices, charts and history will be replaced.'],
    ['Конфигурация импортирована.','Configuration imported.']
    ,['Выберите проверку.','Select a diagnostic test.'],['Выполняется проверка...','Running diagnostic test...'],
    ['через прокси','via proxy'],['Ответ быстрее 1 миллисекунды','Response is faster than 1 millisecond'],
    ['DNS использует Fake-IP 198.18.0.0/15','DNS uses Fake-IP 198.18.0.0/15'],
    ['Реальный ping скрыт VPN/прокси.','The real ping is hidden by the VPN/proxy.'],
    ['RDAP-данные для этого домена или IP не найдены.','No RDAP data was found for this domain or IP address.'],['Запрос','Query'],
    ['DNS-записи не найдены.','No DNS records found.'],['Порты не указаны.','No ports specified.'],['Нет данных.','No data.'],
    ['Действителен','Valid'],['Действует до','Valid until'],['Издатель','Issuer'],['Субъект','Subject'],['Домен','Domain'],['События','Events'],
    ['Порты должны быть числами от 1 до 65535','Ports must be numbers from 1 to 65535'],['Ошибка SSL','SSL error'],['дн.','days'],
    ['Поиск устройств в локальной сети','Find devices on the local network'],['Ручное сканирование частной IPv4-подсети.','Manual scan of a private IPv4 subnet.'],
    ['Сканировать локальную сеть','Scan local network'],['Сканирование локальной сети','Local network scan'],
    ['Проверяются только адреса выбранной частной подсети /24.','Only addresses in the selected private /24 subnet are checked.'],
    ['Начать сканирование','Start scan'],['Укажите подсеть и запустите поиск.','Enter a subnet and start the scan.'],
    ['Определение локальной сети...','Detecting local network...'],['Подсеть определена. Нажмите «Начать сканирование».','Subnet detected. Click “Start scan”.'],
    ['Не удалось определить подсеть автоматически. Введите её вручную.','The subnet could not be detected automatically. Enter it manually.'],
    ['Сканирование выполняется, это может занять несколько секунд...','Scanning is in progress. This may take a few seconds...'],
    ['Найдено устройств:','Devices found:'],['Проверено адресов:','Addresses checked:'],['IP-адрес','IP address'],['MAC-адрес','MAC address'],
    ['Уже добавлено','Already added'],['Активные устройства не найдены. Некоторые устройства могут блокировать Ping.','No active devices were found. Some devices may block Ping.'],
    ['Укажите частную IPv4-подсеть в формате 192.168.1.0/24','Enter a private IPv4 subnet in the format 192.168.1.0/24'],
    ['Некорректный IPv4-адрес','Invalid IPv4 address'],['Разрешено сканирование только частных локальных IPv4-подсетей','Only private local IPv4 subnets can be scanned'],
    ['Показывать','Show'],['Поднять выше','Move up'],['Опустить ниже','Move down'],['Telegram: стикеры MoonFox','Telegram: MoonFox stickers'],
    ['+ Создать график','+ Create chart'],['Создать график','Create chart'],['Объекты на графике','Chart objects'],
    ['Сайты на графике','Sites on chart'],['Устройства на графике','Devices on chart'],['Все','All'],['Снять','Clear'],
    ['Можно выбрать один сайт, одно устройство или любой набор объектов для независимого графика.','You can choose one site, one device, or any set of objects for an independent chart.'],
    ['Нет объектов для выбора','No objects to choose'],['Выбери хотя бы один объект для графика','Select at least one object for the chart'],
    ['Подтвердите удаление','Confirm deletion'],['Объект будет удалён из списка мониторинга. История по нему тоже очистится.','The object will be removed from monitoring. Its history will be cleared too.'],
    ['Удалить сайт?','Delete site?'],['Удалить устройство?','Delete device?'],['Сайт','Site'],['Устройство','Device'],['будет удалён из MoonFox monitor.','will be removed from MoonFox monitor.'],
    ['График','Chart'],['Все сайты','All sites'],['Все устройства','All devices'],['Период','Period'],['1 час','1 hour'],['3 часа','3 hours'],['6 часов','6 hours'],['12 часов','12 hours'],['24 часа','24 hours'],['Свой','Custom'],['мин','min'],
    ['Укажи период от 1 до 10080 минут','Enter a period from 1 to 10080 minutes'],
    ['Колонки','Columns'],['HTTP','HTTP'],['Ping','Ping'],['DNS','DNS'],['SSL','SSL'],['Адрес','Address'],['Порты','Ports'],['Действия','Actions'],
    ['Разрешить ответные команды бота','Enable bot commands'],['Проверять новые команды каждые, сек','Check for new commands every, sec'],
    ['Бот отвечает только сохранённому Telegram chat ID. Команды: /status, /sites, /devices, /problems, /check, /help.','The bot responds only to the saved Telegram chat ID. Commands: /status, /sites, /devices, /problems, /check, /help.'],
    ['Проверить команды бота','Test bot commands'],['Введите Telegram bot token и chat ID.','Enter the Telegram bot token and chat ID.'],
    ['Команды зарегистрированы. Бот отправил список команд в Telegram.','Commands registered. The bot sent the command list to Telegram.'],
    ['Не удалось проверить команды:','Could not test commands:'],
    ['Подтвердите действие','Confirm action'],['Подтвердить','Confirm'],
    ['Очистить события?','Clear events?'],['Журнал событий будет очищен.','The event log will be cleared.'],['Сайты, устройства и настройки останутся без изменений.','Sites, devices and settings will remain unchanged.'],
    ['Сбросить тексты Telegram?','Reset Telegram texts?'],['Тексты уведомлений будут заменены стандартными шаблонами.','Notification texts will be replaced with default templates.'],['Токен, chat ID и остальные настройки Telegram не изменятся.','Token, chat ID and other Telegram settings will not change.'],['Сбросить','Reset'],
    ['Очистить историю графиков?','Clear chart history?'],['История графиков и события будут очищены.','Chart history and events will be cleared.'],['Список сайтов, устройств, графиков и настройки останутся.','The list of sites, devices, charts and settings will remain.'],
    ['Удалить все данные?','Delete all data?'],['Будут удалены сайты, устройства, графики, события и история.','Sites, devices, charts, events and history will be deleted.'],['Настройки программы останутся. Это действие нельзя отменить.','Application settings will remain. This action cannot be undone.'],['Удалить всё','Delete everything'],
    ['Удалить график?','Delete chart?'],['Сайты, устройства и история проверок останутся.','Sites, devices and check history will remain.'],
    ['Импортировать конфигурацию?','Import configuration?'],['Текущие сайты, устройства, графики и история будут заменены данными из файла.','Current sites, devices, charts and history will be replaced with data from the file.'],['Перед импортом лучше экспортировать текущую конфигурацию, если она нужна.','Before importing, export the current configuration if you need it.'],['Импортировать','Import'],
    ['Хранение истории','History retention'],['Режим хранения','Retention mode'],['По количеству записей','By record count'],['По дням','By days'],['Хранить дней','Keep days'],['Максимум записей','Maximum records'],
    ['Пауза мониторинга','Pause monitoring'],['Пауза','Pause'],['Возобновить','Resume'],['⏸️ Пауза','⏸️ Paused'],
    ['За 24 часа','Last 24 hours'],['За 7 дней','Last 7 days'],['Сформировать отчёт HTML','Create HTML report'],['Отчёт CSV','CSV report']
  ];

  const ruToEn = new Map(pairs);
  const enToRu = new Map(pairs.map(([ru,en])=>[en,ru]));
  let language = 'ru';
  let observer = null;
  let translating = false;

  function current(){ return language; }
  function exact(value,target=language){
    const map=target==='en'?ruToEn:enToRu;
    return map.get(value) || value;
  }
  function dynamic(value,target=language){
    let text=String(value??'');
    const map=target==='en'?ruToEn:enToRu;
    const trimmed=text.trim();
    if(map.has(trimmed)) return text.replace(trimmed,map.get(trimmed));
    if(target==='en'){
      text=text
        .replace(/(^|\s)мс(?=$|\s|[,.])/g,'$1ms').replace(/(^|\s)сек(?=$|\s|[,.])/g,'$1sec')
        .replace(/(\d+)ч\s*(\d+)м/g,'$1h $2m').replace(/(\d+)м(?=$|\s)/g,'$1m')
        .replace(/дн\./g,'days')
        .replace(/Онлайн:/g,'Online:').replace(/Доступно:/g,'Available:').replace(/медленно:/g,'slow:')
        .replace(/Сайты:/g,'Sites:').replace(/Устройства:/g,'Devices:').replace(/Критичных:/g,'Critical:')
        .replace(/Проверка:/g,'Check:').replace(/^Сайт «/,'Website “').replace(/^Устройство «/,'Device “').replace(/»:/g,'”:')
        .replace(/Порт свободен:/g,'Port is available:').replace(/Порт занят:/g,'Port is in use:')
        .replace(/Не удалось отправить Telegram:/g,'Could not send Telegram message:')
        .replace(/DNS вернул Fake-IP/g,'DNS returned Fake-IP').replace(/Реальный ping скрыт VPN\/прокси\./g,'The real ping is hidden by the VPN/proxy.')
        .replace(/Сайт "/g,'Website "').replace(/Устройство "/g,'Device "')
        .replace(/ снова доступен/g,' is available again').replace(/ снова доступно/g,' is available again')
        .replace(/ критично медленный/g,' is critically slow').replace(/ критично медленное/g,' is critically slow')
        .replace(/ отвечает медленно/g,' is responding slowly').replace(/ высокий ping/g,' has high ping')
        .replace(/ недоступен/g,' is unavailable').replace(/ недоступно/g,' is unavailable')
        .replace(/ доступен/g,' is available').replace(/ доступно/g,' is available');
    }else{
      text=text
        .replace(/\bms\b/g,'мс').replace(/\bsec\b/g,'сек')
        .replace(/(\d+)h\s*(\d+)m/g,'$1ч $2м').replace(/(\d+)m\b/g,'$1м')
        .replace(/days/g,'дн.')
        .replace(/Online:/g,'Онлайн:').replace(/Available:/g,'Доступно:').replace(/slow:/g,'медленно:')
        .replace(/Sites:/g,'Сайты:').replace(/Devices:/g,'Устройства:').replace(/Critical:/g,'Критичных:')
        .replace(/Check:/g,'Проверка:').replace(/^Website “/,'Сайт «').replace(/^Device “/,'Устройство «').replace(/”:/g,'»:')
        .replace(/Port is available:/g,'Порт свободен:').replace(/Port is in use:/g,'Порт занят:')
        .replace(/Could not send Telegram message:/g,'Не удалось отправить Telegram:')
        .replace(/DNS returned Fake-IP/g,'DNS вернул Fake-IP').replace(/The real ping is hidden by the VPN\/proxy\./g,'Реальный ping скрыт VPN/прокси.')
        .replace(/Website "/g,'Сайт "').replace(/Device "/g,'Устройство "')
        .replace(/ is available again/g,' снова доступен').replace(/ is critically slow/g,' критично медленный')
        .replace(/ is responding slowly/g,' отвечает медленно').replace(/ has high ping/g,' высокий ping')
        .replace(/ is unavailable/g,' недоступен').replace(/ is available/g,' доступен');
    }
    return text;
  }
  function translateTextNode(node){
    if(!node || !node.nodeValue || !node.nodeValue.trim())return;
    const next=dynamic(node.nodeValue);
    if(next!==node.nodeValue)node.nodeValue=next;
  }
  function translateElement(el){
    if(!el || el.nodeType!==1)return;
    ['placeholder','title','aria-label','alt'].forEach(attr=>{
      if(el.hasAttribute(attr)){
        const value=el.getAttribute(attr);
        const next=dynamic(value);
        if(next!==value)el.setAttribute(attr,next);
      }
    });
  }
  function apply(root=document){
    if(translating)return;
    translating=true;
    try{
      translateElement(root);
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(node.nodeType===3)translateTextNode(node);else translateElement(node);
      }
      document.documentElement.lang=language;
    }finally{translating=false}
  }
  function set(next,root=document){
    language=next==='en'?'en':'ru';
    try{localStorage.setItem('moonfox.language',language)}catch(e){}
    apply(root);
    return language;
  }
  function startObserver(){
    if(observer)return;
    observer=new MutationObserver(records=>{
      if(translating)return;
      records.forEach(record=>{
        if(record.type==='characterData')translateTextNode(record.target);
        record.addedNodes.forEach(node=>{
          if(node.nodeType===3)translateTextNode(node);
          else if(node.nodeType===1)apply(node);
        });
      });
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }
  function saved(){
    try{return localStorage.getItem('moonfox.language')==='en'?'en':'ru'}catch(e){return 'ru'}
  }

  const nativeAlert=window.alert.bind(window);
  const nativeConfirm=window.confirm.bind(window);
  window.alert=message=>nativeAlert(dynamic(message));
  window.confirm=message=>nativeConfirm(dynamic(message));

  window.I18N={set,current,apply,text:dynamic,exact,saved,startObserver};
})();
