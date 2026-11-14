'use strict';
// Демонстрационная PDF-справка. На каждом листе — пометка, что это не официальный документ.
const path = require('path');
const PDFDocument = require('pdfkit');
const T = require('./time');
const { purposeOf } = require('./catalog');

const FONT = path.join(__dirname, '..', 'fonts');
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

function certificate({ r, student, staff, payments = [], stipends = [] }, stream) {
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
  doc.fillColor('#14213D').font('S').fontSize(11).text('Концепт «ДГТУ.Сейчас» · факультет «Экономика и управление» (вымышленное подразделение)', 72, 72, { width: w });
  doc.font('R').fontSize(10).fillColor('#5B6577').text('Деканат: корпус 1, каб. 210', { width: w });
  doc.moveDown(2);

  if (r.type === 'tax') {
    const rows = payments.filter((p) => p.paid_on.startsWith(String(r.purpose)));
    const sum = rows.reduce((s, p) => s + p.amount, 0);
    const rub = (n) => n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' руб.';
    doc.fillColor('#14213D').font('B').fontSize(16).text('СПРАВКА', { align: 'center' });
    doc.font('S').fontSize(12).text('об оплате образовательных услуг для представления в налоговый орган', { align: 'center' });
    doc.font('R').fontSize(10).fillColor('#5B6577').text(`№ ${r.number} от ${T.shortDate(issued)} · отчётный год ${r.purpose}`, { align: 'center' });
    doc.moveDown(1.2).fillColor('#14213D').font('R').fontSize(11.5).lineGap(3);
    const kv = (k, v) => { doc.font('S').text(k, { continued: true }).font('R').text(' ' + v); };
    kv('Налогоплательщик:', `${student.full_name} — является обучающимся`);
    kv('ИНН налогоплательщика:', r.details || '—');
    kv('Обучающийся:', `${student.full_name}, ${student.level}, ${student.course} курс, ${student.form} форма обучения`);
    kv('Договор:', `${rows[0]?.contract || '—'} об оказании платных образовательных услуг`);
    doc.moveDown(0.6).font('S').text('Оплата за отчётный год:');
    doc.font('R');
    for (const p of rows) doc.text(`   ${p.paid_on.split('-').reverse().join('.')} — ${rub(p.amount)} (${p.note || 'оплата по договору'}), заказчик: ${p.payer}`);
    doc.moveDown(0.4).font('B').text(`Итого: ${rub(sum)}`);
    doc.moveDown(0.6).font('R').fontSize(10).fillColor('#5B6577').text('Форма справки утверждена приказом ФНС России от 18.10.2023 № ЕД-7-11/755@. Этот файл — демонстрационный образец, а не заполненная официальная форма.', { align: 'justify' });
  } else if (r.type === 'stipend') {
    const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    const rub = (n) => n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' руб.';
    doc.fillColor('#14213D').font('B').fontSize(18).text(`СПРАВКА № ${r.number}`, { align: 'center' });
    doc.font('R').fontSize(11).fillColor('#5B6577').text(`от ${T.shortDate(issued)}`, { align: 'center' });
    doc.moveDown(1.5).fillColor('#14213D').font('R').fontSize(12).lineGap(4);
    doc.text(`Дана ${student.name_dat}, ${student.gender === 'f' ? 'обучающейся' : 'обучающемуся'} на ${student.course} курсе очной формы обучения на бюджетной основе, группа ${student.group_name}, в том, что ${student.gender === 'f' ? 'ей' : 'ему'} выплачена стипендия:`, { align: 'justify' });
    doc.moveDown(0.6);
    for (const x of stipends) { const [y, m] = x.month.split('-').map(Number); doc.text(`   ${MON[m - 1]} ${y} — ${rub(x.amount)}`); }
    doc.moveDown(0.4).font('B').text(`Итого: ${rub(stipends.reduce((a, x) => a + x.amount, 0))}`);
    doc.font('R').moveDown(0.6).text('Вид выплаты: государственная академическая стипендия. Справка выдана для предоставления по месту требования.', { align: 'justify' });
  } else {
    const p = purposeOf('study', r.purpose);
    doc.fillColor('#14213D').font('B').fontSize(18).text(`СПРАВКА № ${r.number}`, { align: 'center' });
    doc.font('S').fontSize(11).text('об обучении (Форма 2)', { align: 'center' });
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
