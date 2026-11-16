# Обновление описания процесса

Из корня репозитория: `python3 scripts/build_process.py`.
Нужен Python 3 с ReportLab (`python3 -m pip install reportlab`). Скрипт использует приложенные Inter TTF и изображения в docs/screenshots, создаёт docs/process.pdf и docs/process.md из одного источника.

Проверка верстки: `pdftoppm -png docs/process.pdf tmp/process`. Итоговый PDF содержит 14 страниц. Скриншоты с именами history-* извлечены из прежнего PDF команды; изображения cabinet-* сняты с опубликованной версии интерфейса 2c3c753 16 ноября 2026 года. Они фиксируют состояние на дату проверки и не обновляются при сборке автоматически.

Оценка помощника: `node scripts/evaluate-assistant.js` (зависимости приложения, временная БД, сеть запрещена). Видео: `python3 -m pip install pillow imageio-ffmpeg`, затем `python3 scripts/build_demo_video.py`. Создаёт 50-секундный MP4 по приложенным кадрам; это не непрерывная запись экрана.
