'use strict';
// Демонстрационная PDF-справка. На каждом листе — пометка, что это не официальный документ.
const path = require('path');
const PDFDocument = require('pdfkit');
const T = require('./time');
const { purposeOf } = require('./catalog');

const FONT = path.join(__dirname, '..', 'fonts');
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function translit(s) {
  return s.split('').map((ch) => { const l = ch.toLowerCase(); const t = TR[l]; if (t == null) return ch; return ch === l ? t : t.charAt(0).toUpperCase() + t.slice(1); }).join('');
}

function certificate({ r, student, staff }, stream) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 72, right: 64 }, info: { Title: `Справка № ${r.number} (демо)`, Author: 'ДГТУ.Сейчас — концепт' } });
  doc.registerFont('R', path.join(FONT, 'Inter_400Regular.ttf'));
  doc.registerFont('S', path.join(FONT, 'Inter_600SemiBold.ttf'));
  doc.registerFont('B', path.join(FONT, 'Inter_700Bold.ttf'));
  doc.pipe(stream);

  // водяной знак
  doc.save().rotate(-35, { origin: [300, 420] }).font('B').fontSize(64).fillColor('#E6EAF2').text('ОБРАЗЕЦ · ДЕМО', 40, 380, { width: 560, align: 'center' }).restore();

  const issued = new Date(r.closed_at || T.now());
  const w = doc.page.width - 72 - 64;
  doc.fillColor('#B42318').font('S').fontSize(9).text('ДЕМОНСТРАЦИОННЫЙ ОБРАЗЕЦ — НЕ ЯВЛЯЕТСЯ ОФИЦИАЛЬНЫМ ДОКУМЕНТОМ ДГТУ', 72, 40, { width: w, align: 'center' });
  doc.fillColor('#14213D').font('S').fontSize(11).text('Концепт «ДГТУ.Сейчас» · факультет «Менеджмент и бизнес» (вымышленное подразделение)', 72, 72, { width: w });
  doc.font('R').fontSize(10).fillColor('#5B6577').text('Деканат: корпус 1, каб. 210', { width: w });
  doc.moveDown(2);

  if (r.type === 'visa') {
    doc.fillColor('#14213D').font('B').fontSize(18).text(`CERTIFICATE No. ${r.number}`, { align: 'center' });
    doc.font('R').fontSize(11).fillColor('#5B6577').text(`Issued on ${T.shortDate(issued)}`, { align: 'center' });
    doc.moveDown(1.5).fillColor('#14213D').font('R').fontSize(12).lineGap(4);
    const nm = translit(student.full_name.split(' ').slice(0, 2).reverse().join(' '));
    doc.text(`This is to certify that ${nm} is a ${student.form === 'очная' ? 'full-time' : 'part-time'} ${student.level === 'магистратура' ? "Master's" : "Bachelor's"} student (year ${student.course}, group ${translit(student.group_name)}) of the Faculty of Management and Business (fictional unit used in a contest prototype).`, { align: 'justify' });
    doc.moveDown(0.8).text(`The student is granted leave during the trip: ${r.details || '—'}. The student's place of study is retained.`, { align: 'justify' });
    doc.moveDown(0.8).text('This certificate is issued for submission to the consulate.', { align: 'justify' });
  } else {
    const p = purposeOf('study', r.purpose);
    doc.fillColor('#14213D').font('B').fontSize(18).text(`СПРАВКА № ${r.number}`, { align: 'center' });
    doc.font('R').fontSize(11).fillColor('#5B6577').text(`от ${T.shortDate(issued)}`, { align: 'center' });
    doc.moveDown(1.5).fillColor('#14213D').font('R').fontSize(12).lineGap(4);
    const verb = student.gender === 'f' ? 'она действительно обучается' : 'он действительно обучается';
    doc.text(`Дана ${student.name_dat} в том, что ${verb} на ${student.course} курсе ${student.form === 'очная' ? 'очной' : 'очно-заочной'} формы обучения по направлению подготовки ${student.program} (${student.level}), группа ${student.group_name}, на ${student.funding === 'бюджет' ? 'бюджетной' : 'договорной'} основе.`, { align: 'justify' });
    doc.moveDown(0.8).text(`Зачётная книжка № ${student.record_book}.`);
    doc.moveDown(0.8).text(`Справка выдана ${p ? p.full : 'для предоставления по месту требования'}${r.details ? ` (${r.details})` : ''}.`, { align: 'justify' });
  }

  doc.moveDown(3).font('R').fontSize(11).fillColor('#14213D');
  doc.text(`${staff ? staff.position.charAt(0).toUpperCase() + staff.position.slice(1) : 'Специалист деканата'}: ${staff ? staff.short_name : '—'}`);
  doc.fontSize(10).fillColor('#5B6577').text('Подпись и печать в демо-версии не ставятся.');

  doc.font('R').fontSize(8.5).fillColor('#5B6577').text(
    'Сформировано в прототипе «ДГТУ.Сейчас» для конкурса MGIMO AI Challenge («Цифровой деканат будущего»). Все люди и данные вымышленные. Документ не имеет юридической силы.',
    72, doc.page.height - 100, { width: w, align: 'center' });
  doc.end();
}

// Небольшой PDF-заглушка для демо-вложения («справка о составе семьи» у вымышленной студентки)
function samplePdf(stream) {
  const doc = new PDFDocument({ size: 'A5', margin: 48 });
  doc.registerFont('R', path.join(FONT, 'Inter_400Regular.ttf'));
  doc.pipe(stream);
  doc.font('R').fontSize(14).text('Демо-вложение', { align: 'center' }).moveDown().fontSize(11)
    .text('Здесь в рабочей версии будет файл, загруженный студентом. В прототипе — заглушка без персональных данных.', { align: 'center' });
  doc.end();
}

module.exports = { certificate, samplePdf };
