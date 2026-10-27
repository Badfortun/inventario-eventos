// ¿Dónde está el material? Reparto por evento y por artículo
import { leer } from '../api.js';
import { h, icono, vacio, descripcionVariante, formatoNum, textoNormal, fecha } from '../ui.js';

export async function render(p) {
  const ex = await leer('v_existencias', { order: 'lugar_fecha.asc,nombre.asc' });
  const enUso = ex.filter(e => ['almacen', 'reparacion', 'evento'].includes(e.lugar_tipo));
  let vista = sessionStorage.getItem('inv2.donde') || 'evento';
  let texto = '';
  const cont = h('div', { class: 'pila' });
  const buscar = h('input', { class: 'input', type: 'search', placeholder: 'Filtrar por artículo o código…', 'aria-label': 'Filtrar' });
  buscar.oninput = () => { texto = buscar.value; pintar(); };
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const coincide = e => textoNormal([e.codigo, e.nombre, e.color_nombre, e.medida, e.tamano].join(' ')).includes(textoNormal(texto));

  function pintar() {
    tabs.replaceChildren(...[['evento', 'Por evento'], ['articulo', 'Por artículo']].map(([k, t]) =>
      h('button', { role: 'tab', class: `tab ${k === vista ? 'activo' : ''}`, 'aria-selected': String(k === vista),
        onclick: () => { vista = k; sessionStorage.setItem('inv2.donde', k); pintar(); } }, t)));
    const filas = enUso.filter(coincide);
    if (vista === 'evento') {
      const porLugar = new Map();
      for (const e of filas) { if (!porLugar.has(e.lugar_id)) porLugar.set(e.lugar_id, []); porLugar.get(e.lugar_id).push(e); }
      const orden = [...porLugar.values()].sort((a, b) => ({ evento: 0, reparacion: 1, almacen: 2 }[a[0].lugar_tipo] - { evento: 0, reparacion: 1, almacen: 2 }[b[0].lugar_tipo]));
      cont.replaceChildren(...(orden.length ? orden.map(items => {
        const l = items[0];
        return h('article', { class: 'tarjeta' },
          h('a', { class: 'fila-entre enlace-limpio', href: `#/lugar/${l.lugar_id}` },
            h('div', null, h('h3', null, l.lugar_nombre), l.lugar_fecha ? h('div', { class: 'tenue pequeno' }, fecha(l.lugar_fecha)) : null),
            h('strong', { class: 'cant-grande' }, `${items.reduce((s, i) => s + i.cantidad, 0)} pz`)),
          h('ul', { class: 'lista-compacta' }, items.map(i => h('li', null,
            h('span', null, i.nombre, h('span', { class: 'tenue' }, ` ${descripcionVariante(i)}`), ' ', h('span', { class: 'sku' }, i.codigo)),
            h('strong', null, formatoNum(i.cantidad))))));
      }) : [vacio('Sin material con este filtro.')]));
    } else {
      const porArt = new Map();
      for (const e of filas) { if (!porArt.has(e.articulo_id)) porArt.set(e.articulo_id, []); porArt.get(e.articulo_id).push(e); }
      cont.replaceChildren(...(porArt.size ? [...porArt.values()].sort((a, b) => a[0].nombre.localeCompare(b[0].nombre)).map(items => {
        const a = items[0];
        const total = items.reduce((s, i) => s + i.cantidad, 0);
        return h('article', { class: 'tarjeta' },
          h('a', { class: 'fila-entre enlace-limpio', href: `#/articulo/${a.articulo_id}` },
            h('div', null, h('h3', null, a.nombre), h('div', { class: 'tenue pequeno' }, [descripcionVariante(a), a.codigo].filter(Boolean).join(' · '))),
            h('strong', { class: 'cant-grande' }, `${total} pz`)),
          h('div', { class: 'barra-reparto', 'aria-hidden': 'true' }, items.map(i => h('span', {
            class: `seg-${i.lugar_tipo}`, style: { flex: i.cantidad }, title: `${i.lugar_nombre}: ${i.cantidad}` }))),
          h('ul', { class: 'lista-compacta' }, items.map(i => h('li', null,
            h('span', null, h('span', { class: `punto punto-${i.lugar_tipo}` }), i.lugar_nombre), h('strong', null, formatoNum(i.cantidad))))));
      }) : [vacio('Sin material con este filtro.')]));
    }
  }

  p.append(
    h('a', { class: 'volver', href: '#/articulos' }, icono('atras', 18), 'Artículos'),
    h('h1', null, '¿Dónde está el material?'),
    h('p', { class: 'tenue' }, 'Lo que hay ahora en cada evento, en Reparación y en el Almacén.'),
    tabs, buscar, cont);
  pintar();
}
