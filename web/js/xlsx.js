// Generador mínimo de archivos Excel .xlsx (sin dependencias).
// hojas: [{ nombre, columnas: [{titulo, ancho, tipo:'n'|'s'}], filas: [[...]] }]

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(archivos) {
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [nombre, contenido] of archivos) {
    const nb = enc.encode(nombre), datos = enc.encode(contenido), crc = crc32(datos);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, hora, true); lh.setUint16(12, fecha, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, datos.length, true); lh.setUint32(22, datos.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    partes.push(new Uint8Array(lh.buffer), nb, datos);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, hora, true); ch.setUint16(14, fecha, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, datos.length, true); ch.setUint32(24, datos.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + datos.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true); fin.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fin.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const nombreHoja = s => String(s).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Hoja';

function hoja({ columnas, filas, titulo }) {
  const filasXml = [];
  let r = 1;
  const celda = (c, v, estilo, tipo) => {
    const ref = `${col(c)}${r}`;
    if (v == null || v === '') return estilo ? `<c r="${ref}" s="${estilo}"/>` : '';
    if (tipo === 'n' && typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  let filaEncabezado = 1;
  if (titulo) {
    for (const linea of titulo) { filasXml.push(`<row r="${r}">${celda(0, linea, linea === titulo[0] ? 2 : 0, 's')}</row>`); r++; }
    r++; filaEncabezado = r;
  }
  filasXml.push(`<row r="${r}">${columnas.map((c, i) => celda(i, c.titulo, 1, 's')).join('')}</row>`); r++;
  for (const f of filas) { filasXml.push(`<row r="${r}">${f.map((v, i) => celda(i, v, 0, columnas[i]?.tipo)).join('')}</row>`); r++; }
  const ultima = Math.max(filaEncabezado, r - 1);
  const rango = `A${filaEncabezado}:${col(columnas.length - 1)}${ultima}`;
  return {
    rango,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${filaEncabezado}" topLeftCell="A${filaEncabezado + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho || 14}" customWidth="1"/>`).join('')}</cols>
<sheetData>${filasXml.join('')}</sheetData>
${filas.length ? `<autoFilter ref="${rango}"/>` : ''}
</worksheet>`,
  };
}

export function crearXlsx(hojas) {
  const hs = hojas.map(hoja);
  const archivos = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${hojas.map((h, i) => `<sheet name="${esc(nombreHoja(h.nombre))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${hs.map((h, i) => hojas[i].filas.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(nombreHoja(hojas[i].nombre)).replace(/'/g, "''")}'!${h.rango.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '').join('')}</definedNames>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${hs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A34"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`],
    ...hs.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, h.xml]),
  ];
  return zip(archivos);
}

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
