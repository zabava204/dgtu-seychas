# -*- coding: utf-8 -*-
"""Видео по кадрам реального локального прохождения; не непрерывная запись экрана."""
from pathlib import Path
import sys,subprocess,textwrap
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg
R=Path(__file__).resolve().parents[1];out=R/'output';tmp=R/'tmp/video';tmp.mkdir(parents=True,exist_ok=True)
font=lambda n:ImageFont.truetype(str(R/'fonts/Inter_400Regular.ttf'),n)
bold=lambda n:ImageFont.truetype(str(R/'fonts/Inter_700Bold.ttf'),n)
scenes=[('next-step-desktop.jpg','Илья: один следующий шаг','Готовый черновик справки уже на главной. Открыть, проверить и отправить.',7),('demo-02-tax.jpg','Данные уже заполнены','Год и договор видны в форме. Незаконченный год выбрать нельзя.',7),('demo-04-staff.jpg','Сотрудник принимает заявку','Взять в работу и сформировать PDF: один маршрут с понятным результатом.',8),('demo-05-ready.jpg','Справка готова','У Ильи появились файл и статус. Результат хранится в заявке.',7),('demo-07-admission.jpg','Анна: от цифр к действию','12 из 50. Две работы дадут до 35: до порога останется ещё 3. Это расчёт программы.',8),('demo-08-plan.jpg','Подготовка между парами','План на семь дней учитывает расписание. Отметка «Сделано» не меняет баллы.',7),('next-step-anna-desktop.jpg','Главная стала спокойнее','Один следующий шаг. Остальные задачи остаются доступны по нажатию.',6)]
for i,(filename,title,body,duration) in enumerate(scenes):
 im=Image.new('RGB',(1920,1080),'#F5F7FA');d=ImageDraw.Draw(im)
 d.text((42,36),'ДГТУ.Сейчас',font=bold(42),fill='#36557F')
 d.text((42,98),'Демонстрация по кадрам · локальный прототип · вымышленные данные',font=font(25),fill='#526078')
 y=220
 for line in textwrap.wrap(title,18):d.text((42,y),line,font=bold(37),fill='#14213D');y+=50
 y+=24
 for line in textwrap.wrap(body,25):d.text((42,y),line,font=font(28),fill='#526078');y+=41
 screen=Image.open(R/'docs/screenshots'/filename).convert('RGB');screen.thumbnail((1400,880),Image.Resampling.LANCZOS);im.paste(screen,(480+(1400-screen.width)//2,168))
 d.text((42,1008),f'{i+1} / {len(scenes)} · Без озвучки',font=font(24),fill='#526078');im.save(tmp/f'{i:02}.png')
with (tmp/'frames.txt').open('w') as f:
 for i,(_,_,_,duration) in enumerate(scenes):f.write(f"file '{i:02}.png'\nduration {duration}\n")
 f.write(f"file '{len(scenes)-1:02}.png'\n")
cmd=[imageio_ffmpeg.get_ffmpeg_exe(),'-y','-loglevel','error','-f','concat','-safe','0','-i',str(tmp/'frames.txt'),'-t','50','-vf','fps=25','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'dgtu-seychas-demo-50s.mp4')]
subprocess.run(cmd,check=True);print(out/'dgtu-seychas-demo-50s.mp4')
