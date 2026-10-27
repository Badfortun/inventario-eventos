// SOLO PARA PRUEBAS LOCALES (no se publica).
// Imita las APIs de Supabase (auth + PostgREST) sobre un PostgreSQL local
// para probar la app completa sin una cuenta en la nube.
// Uso: node dev/servidor-pruebas.mjs [puerto] [base]
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUERTO = Number(process.argv[2] || 8080);
const BASE = process.argv[3] || 'inv2_dev';
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const tokens = new Map(); // token -> uid
const refresh = new Map(); // refresh -> uid

function psql(sql) {
  return new Promise((ok, mal) => {
    const p = spawn('psql', ['-h', process.env.PGHOST || '/tmp', '-U', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', BASE]);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', c => (c === 0 ? ok(out.trim()) : mal(new Error(err.replace(/^psql:[^:]*:\d+: /gm, '').replace(/^ERROR:\s*/m, '').trim()))));
    p.stdin.end(sql);
  });
}
const lit = v => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const ident = c => { if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`columna no válida: ${c}`); return c; };

function comoUsuario(uid, consulta) {
  return `\\o /dev/null\nselect set_config('request.jwt.claim.sub', ${lit(uid || '')}, false);\nset role ${uid ? 'authenticated' : 'anon'};\n\\o\n${consulta};\n`;
}

function filtro(col, expr) {
  const m = expr.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|in|ilike|like|is)\.(.*)$/s);
  if (!m) throw new Error(`filtro no soportado: ${col}=${expr}`);
  const [, neg, op, val] = m;
  const c = ident(col);
  let s;
  if (op === 'in') s = `${c} in (${val.replace(/^\(|\)$/g, '').split(',').map(x => lit(x.replace(/^"|"$/g, ''))).join(',')})`;
  else if (op === 'is') s = `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
  else if (op === 'ilike' || op === 'like') s = `${c} ${op} ${lit(val.replace(/\*/g, '%'))}`;
  else s = `${c} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${lit(val)}`;
  return neg ? `not (${s})` : s;
}

function consultaSelect(tabla, qs) {
  ident(tabla);
  const sel = qs.get('select') || '*';
  const cols = sel === '*' ? '*' : sel.split(',').map(ident).join(',');
  const where = [];
  let order = '', limit = '', offset = '';
  for (const [k, v] of qs) {
    if (k === 'select') continue;
    if (k === 'order') order = ' order by ' + v.split(',').map(x => { const [c, d, n] = x.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'} ${n === 'nullsfirst' ? 'nulls first' : 'nulls last'}`; }).join(',');
    else if (k === 'limit') limit = ` limit ${Number(v)}`;
    else if (k === 'offset') offset = ` offset ${Number(v)}`;
    else if (k === 'and') where.push(...v.replace(/^\(|\)$/g, '').split(',').map(x => { const i = x.indexOf('.'); return filtro(x.slice(0, i), x.slice(i + 1)); }));
    else if (k === 'or') where.push('(' + v.replace(/^\(|\)$/g, '').split(',').map(x => { const i = x.indexOf('.'); return filtro(x.slice(0, i), x.slice(i + 1)); }).join(' or ') + ')');
    else where.push(filtro(k, v));
  }
  return `select coalesce(json_agg(t), '[]'::json) from (select ${cols} from public.${tabla}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}${offset}) t`;
}

function sesion(uid) {
  const access_token = randomUUID(), refresh_token = randomUUID();
  tokens.set(access_token, uid); refresh.set(refresh_token, uid);
  return { access_token, refresh_token, token_type: 'bearer', expires_in: 3600, user: { id: uid } };
}

async function leerCuerpo(req) {
  let b = '';
  for await (const c of req) b += c;
  return b ? JSON.parse(b) : {};
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname.startsWith('/auth/v1/')) {
      const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
      if (url.pathname === '/auth/v1/signup') {
        if (!cuerpo.password || cuerpo.password.length < 6) return json(422, { msg: 'Password should be at least 6 characters' });
        const existe = await psql(`select count(*) from auth.users where email = ${lit(cuerpo.email)}`);
        if (existe !== '0') return json(422, { msg: 'User already registered' });
        const uid = await psql(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values (${lit(cuerpo.email)}, extensions.crypt(${lit(cuerpo.password)}, extensions.gen_salt('bf')), ${lit(JSON.stringify(cuerpo.data || {}))}::jsonb) returning id`);
        return json(200, sesion(uid));
      }
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') {
          const uid = await psql(`select id from auth.users where email = ${lit(cuerpo.email)} and encrypted_password = extensions.crypt(${lit(cuerpo.password)}, encrypted_password)`);
          if (!uid) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          return json(200, sesion(uid));
        }
        const uid = refresh.get(cuerpo.refresh_token);
        if (!uid) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return json(200, sesion(uid));
      }
      if (url.pathname === '/auth/v1/logout') return json(204, {});
      return json(404, { msg: 'no encontrado' });
    }

    if (url.pathname.startsWith('/rest/v1/')) {
      const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
      const uid = tokens.get(tok);
      if (tok && !uid) return json(401, { message: 'JWT expired' });
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpc && req.method === 'POST') {
        const cuerpo = await leerCuerpo(req);
        const args = Object.entries(cuerpo).map(([k, v]) => `${ident(k)} := ${lit(typeof v === 'object' ? JSON.stringify(v) : v)}${k === 'p_idem' ? '::uuid' : k === 'p_args' ? '::jsonb' : ''}`);
        const out = await psql(comoUsuario(uid, `select coalesce(public.${rpc[1]}(${args.join(', ')})::text, 'null')`));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(out || 'null');
      }
      const tabla = url.pathname.slice('/rest/v1/'.length);
      const out = await psql(comoUsuario(uid, consultaSelect(tabla, url.searchParams)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(out || '[]');
    }

    // Archivos estáticos
    if (url.pathname === '/config.js') {
      const original = await readFile(path.join(WEB, 'config.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end(original.replace(/SUPABASE_URL: '[^']*'/, `SUPABASE_URL: 'http://localhost:${PUERTO}'`)
        .replace(/SUPABASE_ANON_KEY: '[^']*'/, `SUPABASE_ANON_KEY: 'clave-de-pruebas'`));
    }
    const ruta = path.normalize(path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!ruta.startsWith(WEB)) return json(403, {});
    const datos = await readFile(ruta);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(ruta)] || 'application/octet-stream' });
    res.end(datos);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('no encontrado'); }
    const permiso = /permission denied|insufficient_privilege/i.test(e.message);
    json(permiso ? 403 : 400, { message: e.message, code: permiso ? '42501' : 'P0001' });
  }
}).listen(PUERTO, () => console.log(`Servidor de pruebas en http://localhost:${PUERTO} (base ${BASE})`));
