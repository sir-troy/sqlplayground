/* SQL Playground engine: dialect translation to SQLite + extra functions + sample data */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- dialects
  const DIALECTS = {
    sqlite:     { name: 'SQLite',             short: 'SQLite',     native: true,  dqString: false, bracketId: false, backslash: false },
    mysql:      { name: 'MySQL / MariaDB',    short: 'MySQL',      native: false, dqString: true,  bracketId: false, backslash: true },
    postgres:   { name: 'PostgreSQL',         short: 'Postgres',   native: false, dqString: false, bracketId: false, backslash: false },
    mssql:      { name: 'SQL Server (T-SQL)', short: 'T-SQL',      native: false, dqString: false, bracketId: true,  backslash: false },
    oracle:     { name: 'Oracle',             short: 'Oracle',     native: false, dqString: false, bracketId: false, backslash: false },
    maxcompute: { name: 'MaxCompute (ODPS)',  short: 'MaxCompute', native: false, dqString: true,  bracketId: false, backslash: true },
    hive:       { name: 'Hive / Spark SQL',   short: 'Hive/Spark', native: false, dqString: true,  bracketId: false, backslash: true },
  };

  let CURRENT = 'sqlite';

  // ---------------------------------------------------------------- raw split
  // Split raw SQL into statements (respecting strings/comments). Returns [{start,end,text}]
  function splitRaw(text, dialect) {
    const d = DIALECTS[dialect] || DIALECTS.sqlite;
    if (dialect === 'mssql') text = text.replace(/^([ \t]*)GO[ \t]*$/gim, (m, a) => a + ';' + ' '.repeat(m.length - a.length - 1));
    const out = [];
    let i = 0, start = 0, lineStart = true;
    const n = text.length;
    const push = (end) => {
      const t = text.slice(start, end);
      if (t.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) out.push({ start, end, text: t });
    };
    while (i < n) {
      const c = text[i], nx = text[i + 1];
      if (lineStart && c === '\\' && dialect === 'postgres' && !text.slice(start, i).trim()) {
        let j = text.indexOf('\n', i); if (j < 0) j = n;
        start = i; push(j); start = j; i = j; continue;
      }
      if (c === '\n') { lineStart = true; i++; continue; }
      if (c !== ' ' && c !== '\t' && c !== '\r') lineStart = false;
      if (c === '-' && nx === '-') { const j = text.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '#' && dialect === 'mysql') { const j = text.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && nx === '*') { const j = text.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (c === "'" || c === '"' || c === '`' || (c === '[' && d.bracketId)) {
        const close = c === '[' ? ']' : c; let j = i + 1;
        while (j < n) {
          if (text[j] === '\\' && d.backslash && c !== '`' && c !== '[') { j += 2; continue; }
          if (text[j] === close) { if (text[j + 1] === close && c !== '[') { j += 2; continue; } break; }
          j++;
        }
        i = j + 1; continue;
      }
      if (c === ';') {
        // keep CREATE TRIGGER ... BEGIN ... END together
        const sofar = text.slice(start, i);
        if (/^\s*(?:--[^\n]*\n\s*)*CREATE\s+(?:TEMP\w*\s+)?TRIGGER\b/i.test(sofar) && !/\bEND\s*$/i.test(sofar)) { i++; continue; }
        push(i); start = i + 1; i++; continue;
      }
      i++;
    }
    push(n);
    return out;
  }

  // ---------------------------------------------------------------- masking
  const S0 = '', S1 = '', I0 = '', I1 = '';
  const STR = '\\d+', IDP = '\\d+';
  const IDENT = '(?:' + IDP + '|[A-Za-z_][\\w$]*)(?:\\.(?:' + IDP + '|[A-Za-z_][\\w$]*))*';

  function mask(sql, dialect) {
    const d = DIALECTS[dialect];
    const lits = [];
    let out = '', i = 0; const n = sql.length;
    while (i < n) {
      const c = sql[i], nx = sql[i + 1];
      if (c === '-' && nx === '-') { const j = sql.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '#' && dialect === 'mysql') { const j = sql.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && nx === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; out += ' '; continue; }
      if (c === "'" || c === '"' || c === '`' || (c === '[' && d.bracketId)) {
        const close = c === '[' ? ']' : c; let j = i + 1, val = '';
        while (j < n) {
          const ch = sql[j];
          if (ch === '\\' && d.backslash && c !== '`' && c !== '[') {
            const e = sql[j + 1];
            val += ({ n: '\n', t: '\t', r: '\r', '0': '\0' })[e] ?? e; j += 2; continue;
          }
          if (ch === close) { if (sql[j + 1] === close && c !== '[') { val += close; j += 2; continue; } break; }
          val += ch; j++;
        }
        i = j + 1;
        const isStr = c === "'" || (c === '"' && d.dqString);
        if (isStr) {
          // T-SQL N'..' / Postgres E'..' prefixes
          if (/(^|[^\w])[NnEe]$/.test(out)) out = out.slice(0, -1);
          lits.push("'" + val.replace(/'/g, "''") + "'");
          out += S0 + (lits.length - 1) + S1;
        } else {
          lits.push('"' + val.replace(/"/g, '""') + '"');
          out += I0 + (lits.length - 1) + I1;
        }
        continue;
      }
      out += c; i++;
    }
    return { s: out, lits };
  }
  function unmask(s, lits) {
    return s.replace(/[](\d+)[]/g, (m, k) => lits[+k]);
  }
  function addLit(lits, value) { lits.push("'" + String(value).replace(/'/g, "''") + "'"); return S0 + (lits.length - 1) + S1; }
  function litValue(ph, lits) {
    const m = /^\s*[](\d+)[]\s*$/.exec(ph);
    if (!m) return null; const L = lits[+m[1]]; return L.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"');
  }

  // ---------------------------------------------------------------- helpers
  function splitArgs(inner) {
    const args = []; let depth = 0, cur = '';
    for (const ch of inner) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { args.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim() !== '' || args.length) args.push(cur);
    return args.map(a => a.trim());
  }
  // find NAME( ... ) calls and replace via fn(inner, args, NAME) -> string|null
  function rewriteCalls(s, names, fn) {
    const re = new RegExp('(^|[^\\w$.])(' + names + ')\\s*\\(', 'gi');
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      const start = m.index + m[1].length, open = re.lastIndex - 1;
      let depth = 0, j = open;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) break; } }
      if (j >= s.length) break;
      const inner = rewriteCalls(s.slice(open + 1, j), names, fn);
      const rep = fn(inner, splitArgs(inner), m[2].toUpperCase());
      out += s.slice(last, start) + (rep == null ? s.slice(start, open + 1) + inner + ')' : rep);
      last = j + 1; re.lastIndex = j + 1;
    }
    return out + s.slice(last);
  }
  // locate the operand ending right before index idx (exclusive). returns start index.
  function operandStart(s, idx) {
    let j = idx - 1; while (j >= 0 && /\s/.test(s[j])) j--;
    if (j < 0) return idx;
    if (s[j] === ')') {
      let depth = 0;
      for (; j >= 0; j--) { if (s[j] === ')') depth++; else if (s[j] === '(') { depth--; if (depth === 0) break; } }
      let k = j - 1; while (k >= 0 && /[\w$.]/.test(s[k])) k--; return k + 1;
    }
    if (s[j] === S1 || s[j] === I1) { const k = s.lastIndexOf(s[j] === S1 ? S0 : I0, j); let q = k - 1; while (q >= 0 && /[\w$.]/.test(s[q])) q--; return q + 1; }
    let k = j; while (k >= 0 && /[\w$.]/.test(s[k])) k--; return k + 1;
  }
  function castTo(expr, type) {
    const t = type.trim().toUpperCase().replace(/\s*\(.*\)$/, '');
    if (/^(DATE)$/.test(t)) return 'date(' + expr + ')';
    if (/^(DATETIME\d?|TIMESTAMP(TZ)?|TIMESTAMP WITH(OUT)? TIME ZONE|SMALLDATETIME)$/.test(t)) return 'datetime(' + expr + ')';
    if (/^(TIME)$/.test(t)) return 'time(' + expr + ')';
    if (/^(STRING|N?VARCHAR2?|N?CHAR|CHARACTER( VARYING)?|N?TEXT|CLOB|JSONB?|UUID|BINARY|VARBINARY|BYTEA)$/.test(t)) {
      const lm = /\(\s*(\d+)\s*\)/.exec(type);
      return lm ? 'SUBSTR(CAST(' + expr + ' AS TEXT), 1, ' + lm[1] + ')' : 'CAST(' + expr + ' AS TEXT)';
    }
    if (/^((BIG|SMALL|TINY|MEDIUM)?INT(EGER)?\d*|SIGNED( INTEGER)?|UNSIGNED( INTEGER)?|LONG|BOOL(EAN)?|BIT)$/.test(t)) return 'CAST(' + expr + ' AS INTEGER)';
    if (/^(DOUBLE( PRECISION)?|FLOAT\d*|REAL|DECIMAL|NUMERIC|NUMBER|MONEY)$/.test(t)) {
      const m = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(type);
      return m ? 'ROUND(CAST(' + expr + ' AS REAL), ' + m[1] + ')' : 'CAST(' + expr + ' AS REAL)';
    }
    return 'CAST(' + expr + ' AS ' + type + ')';
  }
  function splitAs(inner) {
    // split "expr AS type" at last top-level AS
    let depth = 0, pos = -1; const re = /\bAS\b/gi; let m;
    const depthAt = []; let dd = 0; for (let i = 0; i < inner.length; i++) { if (inner[i] === '(') dd++; else if (inner[i] === ')') dd--; depthAt[i] = dd; }
    while ((m = re.exec(inner))) if ((depthAt[m.index] || 0) === 0) pos = m.index;
    if (pos < 0) return null; void depth;
    return [inner.slice(0, pos).trim(), inner.slice(pos + 2).trim()];
  }
  const UNIT_RE = '(MICROSECOND|SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|QUARTER|YEAR)S?';

  // ---------------------------------------------------------------- translation
  function translateStatement(raw, dialect) {
    const notes = [];
    if (dialect === 'sqlite') return { sql: [raw.trim()], notes };
    const { s: m0, lits } = mask(raw, dialect);
    let s = m0.trim();
    const U = (x) => x.toUpperCase();
    const tableName = (ph) => litValue(ph, lits) ?? ph.replace(/^.*\./, '');
    const META_TABLES = "SELECT name AS table_name, type AS table_type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
    const describe = (t) => {
      const name = addLit(lits, tableName(t));
      return "SELECT name AS column_name, type AS data_type, CASE WHEN \"notnull\" THEN 'NO' ELSE 'YES' END AS is_nullable, CASE WHEN pk THEN 'PRI' ELSE '' END AS key, dflt_value AS default_value FROM pragma_table_info(" + name + ')';
    };

    // ---- whole-statement commands
    const early = earlyCommand();
    if (early) return { sql: early.sql.map(q => unmask(q, lits)), notes };
    function earlyCommand() {
    let mm;
    if (/^SHOW\s+(FULL\s+)?TABLES\b/i.test(s) || /^\\dt\b/.test(s) || /^EXEC(UTE)?\s+sp_tables\b/i.test(s) || /^sp_tables\b/i.test(s)) return { sql: [META_TABLES], notes };
    if (/^SHOW\s+(DATABASES|SCHEMAS)\b/i.test(s) || /^\\l\b/.test(s)) return { sql: ["SELECT 'main' AS database_name"], notes };
    if ((mm = new RegExp('^(?:DESCRIBE|DESC|SHOW\\s+(?:FULL\\s+)?COLUMNS\\s+(?:FROM|IN)|\\\\d\\+?|(?:EXEC(?:UTE)?\\s+)?sp_columns|(?:EXEC(?:UTE)?\\s+)?sp_help)\\s+(?:TABLE\\s+)?(' + IDENT + '|' + STR + ')\\s*$', 'i').exec(s))) return { sql: [describe(mm[1])], notes };
    if ((mm = new RegExp('^SHOW\\s+CREATE\\s+TABLE\\s+(' + IDENT + ')\\s*$', 'i').exec(s))) return { sql: ['SELECT name AS "Table", sql AS "Create Table" FROM sqlite_master WHERE name = ' + addLit(lits, tableName(mm[1]))], notes };
    if ((mm = new RegExp('^SHOW\\s+PARTITIONS\\s+(' + IDENT + ')\\s*$', 'i').exec(s))) {
      notes.push('Partitions are emulated as a regular column (assumed name: ds).');
      return { sql: ['SELECT DISTINCT ds AS partition FROM ' + mm[1] + ' ORDER BY 1'], notes };
    }
    if (/^USE\s+/i.test(s)) return { sql: ["SELECT 'Database changed (single in-browser database)' AS message"], notes };
    if (/^SET\s+(?!@)/i.test(s) || /^SET\s+@/i.test(s) && dialect !== 'mysql') { notes.push('SET statement accepted (no effect in the emulator).'); return { sql: ["SELECT 'OK' AS result"], notes }; }
    if (/^(ALTER\s+SESSION|ANALYZE\s+TABLE|MSCK\s+REPAIR|REFRESH\s+TABLE|INVALIDATE\s+METADATA)\b/i.test(s)) return { sql: ["SELECT 'OK' AS result"], notes };
    if (/^(BEGIN\s+TRAN(SACTION)?|START\s+TRANSACTION)\b/i.test(s)) s = 'BEGIN';
    if (/^COMMIT\s+TRAN(SACTION)?\b/i.test(s)) s = 'COMMIT';
    if (/^SET\s+@/i.test(s)) {
      notes.push('MySQL user variables are not supported.');
    }
    return null;
    }

    // ---- information schema / catalog views
    s = s.replace(/\bINFORMATION_SCHEMA\.TABLES\b/gi, "(SELECT 'main' AS table_schema, name AS table_name, CASE type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%')");
    s = s.replace(/\bINFORMATION_SCHEMA\.COLUMNS\b/gi, "(SELECT 'main' AS table_schema, m.name AS table_name, p.name AS column_name, p.cid + 1 AS ordinal_position, p.type AS data_type, CASE WHEN p.\"notnull\" THEN 'NO' ELSE 'YES' END AS is_nullable, p.dflt_value AS column_default FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%')");
    s = s.replace(/\b(USER_TABLES|ALL_TABLES|SYS\.TABLES|PG_CATALOG\.PG_TABLES|PG_TABLES)\b/gi, "(SELECT name AS table_name, name AS tablename FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')");

    // ---- line-level syntax
    if (dialect === 'oracle') {
      s = s.replace(/\bFROM\s+DUAL\b/gi, '');
      s = s.replace(/\b(SYSDATE|SYSTIMESTAMP)\b(?!\s*\()/gi, 'NOW()');
    }
    // current date/time in local time (SQLite's CURRENT_TIMESTAMP is UTC)
    s = s.replace(/\b(CURRENT_TIMESTAMP|LOCALTIMESTAMP)\b(?!\s*\()/gi, 'NOW()');
    s = s.replace(/\b(CURRENT_TIMESTAMP|LOCALTIMESTAMP)\s*\(\s*\d*\s*\)/gi, 'NOW()');
    s = s.replace(/\bCURRENT_DATE\b(?!\s*\()/gi, 'CURDATE()');
    s = s.replace(/\bCURRENT_TIME\b(?!\s*\()/gi, 'CURTIME()');

    // INTERVAL n UNIT  -> INTERVAL 'n unit'
    s = s.replace(new RegExp('\\bINTERVAL\\s+(-?\\d+(?:\\.\\d+)?|' + STR + ')\\s+' + UNIT_RE + '\\b', 'gi'), (m, v, u) => {
      const val = litValue(v, lits) ?? v; return 'INTERVAL ' + addLit(lits, val + ' ' + u.toLowerCase());
    });

    // casts
    s = rewriteCalls(s, 'CAST|TRY_CAST|SAFE_CAST', (inner) => { const p = splitAs(inner); return p ? castTo(p[0], p[1]) : null; });
    if (dialect === 'mssql') s = rewriteCalls(s, 'CONVERT|TRY_CONVERT', (inner, a) => a.length >= 2 ? castTo(a[1], a[0]) : null);
    if (dialect === 'mysql') s = rewriteCalls(s, 'CONVERT', (inner, a) => a.length === 2 ? castTo(a[0], a[1]) : null);
    if (s.includes('::')) {
      const re = /::\s*([A-Za-z_][\w ]*?(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?)(?=[\s,);]|$|::|\|\||[+\-*/<>=])/;
      let guard = 0, m;
      while ((m = re.exec(s)) && guard++ < 200) {
        const st = operandStart(s, m.index);
        const expr = s.slice(st, m.index).trim();
        s = s.slice(0, st) + castTo(expr, m[1].replace(/\[\]$/, '')) + s.slice(m.index + m[0].length);
      }
    }

    // EXTRACT(unit FROM x), POSITION(a IN b), SUBSTRING(x FROM a FOR b)
    s = rewriteCalls(s, 'EXTRACT', (inner) => { const m = /^\s*(\w+)\s+FROM\s+([\s\S]+)$/i.exec(inner); return m ? "EXTRACT_PART('" + m[1].toLowerCase() + "', " + m[2] + ')' : null; });
    s = rewriteCalls(s, 'POSITION', (inner) => { const m = /^([\s\S]+?)\s+IN\s+([\s\S]+)$/i.exec(inner); return m ? 'INSTR(' + m[2] + ', ' + m[1] + ')' : null; });
    s = rewriteCalls(s, 'SUBSTRING', (inner) => {
      const m = /^([\s\S]+?)\s+FROM\s+([\s\S]+?)(?:\s+FOR\s+([\s\S]+))?$/i.exec(inner);
      return m ? 'SUBSTR(' + m[1] + ', ' + m[2] + (m[3] ? ', ' + m[3] : '') + ')' : null;
    });
    s = rewriteCalls(s, 'TRIM', (inner) => {
      const m = /^\s*(BOTH|LEADING|TRAILING)?\s*([\s\S]*?)\s*FROM\s+([\s\S]+)$/i.exec(inner);
      if (!m) return null; const fn = { LEADING: 'LTRIM', TRAILING: 'RTRIM' }[U(m[1] || '')] || 'TRIM';
      return fn + '(' + m[3] + (m[2] ? ', ' + m[2] : '') + ')';
    });

    // date arithmetic
    s = rewriteCalls(s, 'DATE_ADD|DATE_SUB|ADDDATE|SUBDATE', (inner, a, name) => {
      if (a.length !== 2) return null;
      const sign = /SUB/.test(name) ? '-' : '+';
      const m = new RegExp('^INTERVAL\\s+(' + STR + ')$', 'i').exec(a[1]);
      if (m) return 'INTERVAL_ADD(' + a[0] + ", '" + sign + "', " + m[1] + ')';
      return 'INTERVAL_ADD(' + a[0] + ", '" + sign + "', " + a[1] + " || ' day')"; // Hive date_add(d, n)
    });
    {
      const re = new RegExp('([+-])\\s*INTERVAL\\s+(' + STR + ')', 'i'); let m, guard = 0;
      while ((m = re.exec(s)) && guard++ < 100) {
        const st = operandStart(s, m.index); const expr = s.slice(st, m.index).trim();
        if (!expr) break;
        s = s.slice(0, st) + 'INTERVAL_ADD(' + expr + ", '" + m[1] + "', " + m[2] + ')' + s.slice(m.index + m[0].length);
      }
    }
    s = rewriteCalls(s, 'TIMESTAMPDIFF|TIMESTAMPADD', (inner, a, name) => a.length === 3 && /^\w+$/.test(a[0]) ? name + "('" + a[0].toLowerCase() + "', " + a[1] + ', ' + a[2] + ')' : null);
    if (dialect === 'mssql') {
      s = rewriteCalls(s, 'DATEADD', (inner, a) => a.length === 3 && /^\w+$/.test(a[0]) ? "TSQL_DATEADD('" + a[0].toLowerCase() + "', " + a[1] + ', ' + a[2] + ')' : null);
      s = rewriteCalls(s, 'DATEDIFF|DATEDIFF_BIG', (inner, a) => a.length === 3 && /^\w+$/.test(a[0]) ? "TSQL_DATEDIFF('" + a[0].toLowerCase() + "', " + a[1] + ', ' + a[2] + ')' : null);
      s = rewriteCalls(s, 'DATEPART|DATENAME', (inner, a, name) => a.length === 2 && /^\w+$/.test(a[0]) ? (name === 'DATENAME' ? 'TSQL_DATENAME' : 'EXTRACT_PART') + "('" + a[0].toLowerCase() + "', " + a[1] + ')' : null);
      s = rewriteCalls(s, 'DATETRUNC', (inner, a) => a.length === 2 && /^\w+$/.test(a[0]) ? "DATE_TRUNC('" + a[0].toLowerCase() + "', " + a[1] + ')' : null);
      s = rewriteCalls(s, 'ISNULL', (inner, a) => a.length === 2 ? 'IFNULL(' + inner + ')' : null);
      // string concatenation with +
      s = s.replace(new RegExp('(' + STR + ')\\s*\\+(?!\\s*\\d)', 'g'), '$1 ||').replace(new RegExp('\\+\\s*(' + STR + ')', 'g'), '|| $1');
      s = s.replace(/\bN?VARCHAR\s*\(\s*MAX\s*\)/gi, 'TEXT');
    }
    if (dialect === 'postgres') {
      s = s.replace(/\bRANDOM\s*\(\s*\)/gi, 'RAND()');
      s = rewriteCalls(s, 'GENERATE_SERIES', (inner, a) => {
        if (a.length < 2) return null; const step = a[2] || '1';
        return '(WITH RECURSIVE _gs(generate_series) AS (SELECT ' + a[0] + ' UNION ALL SELECT generate_series + (' + step + ') FROM _gs WHERE generate_series + (' + step + ') <= ' + a[1] + ') SELECT generate_series FROM _gs)';
      });
    }

    // generic function renames
    s = rewriteCalls(s, 'GREATEST', (inner) => 'MAX(' + inner + ')');
    s = rewriteCalls(s, 'LEAST', (inner) => 'MIN(' + inner + ')');
    const gc = (x, sep) => { const dm = /^DISTINCT\s+([\s\S]+)$/i.exec(x); if (!dm) return 'GROUP_CONCAT(' + x + (sep ? ', ' + sep : '') + ')'; const sv = sep ? litValue(sep, lits) : ','; return sv === ',' ? 'GROUP_CONCAT(DISTINCT ' + dm[1] + ')' : 'REPLACE(GROUP_CONCAT(DISTINCT ' + dm[1] + "), ',', " + (sep || "','") + ')'; };
    s = rewriteCalls(s, 'STRING_AGG|LISTAGG', (inner, a) => gc(a[0], a[1]));
    s = rewriteCalls(s, 'GROUP_CONCAT', (inner, a) => a.length === 2 && /^DISTINCT\s/i.test(a[0]) ? gc(a[0], a[1]) : null);
    s = s.replace(/\)\s*WITHIN\s+GROUP\s*\(\s*ORDER\s+BY[^)]*\)/gi, ')');
    s = rewriteCalls(s, 'WM_CONCAT', (inner, a) => a.length === 2 ? gc(a[1], a[0]) : null);
    s = rewriteCalls(s, 'COLLECT_LIST|ARRAY_AGG', (inner) => 'json_group_array(' + inner + ')');
    s = rewriteCalls(s, 'COLLECT_SET', (inner) => 'json_group_array(DISTINCT ' + inner + ')');
    s = rewriteCalls(s, 'GET_JSON_OBJECT|JSON_VALUE|JSON_EXTRACT_SCALAR|JSON_EXTRACT_PATH_TEXT', (inner, a, name) => {
      if (name === 'JSON_EXTRACT_PATH_TEXT') return 'json_extract(' + a[0] + ", '$." + a.slice(1).map(x => litValue(x, lits) ?? x).join('.') + "')";
      return 'json_extract(' + inner + ')';
    });
    s = rewriteCalls(s, 'DECODE', (inner, a) => {
      if (a.length < 3) return null; let r = 'CASE ' + a[0]; let k = 1;
      for (; k + 1 < a.length; k += 2) r += ' WHEN ' + a[k] + ' THEN ' + a[k + 1];
      if (k < a.length) r += ' ELSE ' + a[k];
      return r + ' END';
    });
    s = rewriteCalls(s, 'NVL2', (inner, a) => a.length === 3 ? 'CASE WHEN ' + a[0] + ' IS NOT NULL THEN ' + a[1] + ' ELSE ' + a[2] + ' END' : null);
    if (dialect === 'mysql' || dialect === 'maxcompute' || dialect === 'hive') s = rewriteCalls(s, 'IF', (inner) => 'IIF(' + inner + ')');
    s = rewriteCalls(s, 'LEFT', (inner, a) => a.length === 2 ? 'STR_LEFT(' + inner + ')' : null);
    s = rewriteCalls(s, 'RIGHT', (inner, a) => a.length === 2 ? 'STR_RIGHT(' + inner + ')' : null);
    s = s.replace(/\bNOT\s+ILIKE\b/gi, 'NOT LIKE').replace(/\bILIKE\b/gi, 'LIKE');
    s = s.replace(/\bRLIKE\b/gi, 'REGEXP');
    s = s.replace(/\s~\*?\s/g, ' REGEXP ');
    s = s.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT OR IGNORE');

    // paging
    s = s.replace(/\bOFFSET\s+(\d+)\s+ROWS?\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/gi, 'LIMIT $2 OFFSET $1');
    s = s.replace(/\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/gi, 'LIMIT $1');
    s = s.replace(/\bOFFSET\s+(\d+)\s+ROWS?\b/gi, 'LIMIT -1 OFFSET $1');
    if (dialect === 'mysql' || dialect === 'hive' || dialect === 'maxcompute') s = s.replace(/\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1');
    if (dialect === 'mssql') {
      const m = /^(\s*(?:WITH[\s\S]*?\)\s*)?SELECT\s+(?:DISTINCT\s+)?)TOP\s*\(?\s*(\d+)\s*\)?\s*(PERCENT\s+)?/i.exec(s);
      if (m && !m[3]) { s = s.slice(0, m.index) + m[1] + s.slice(m.index + m[0].length) + ' LIMIT ' + m[2]; }
      s = s.replace(/\bSELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s+/gi, (x) => { notes.push('Nested TOP n is not supported; ignored.'); return x.replace(/TOP\s*\(?\s*\d+\s*\)?\s+/i, ''); });
    }
    if (dialect === 'oracle') {
      const m = /\s+(WHERE|AND)\s+ROWNUM\s*(<=?)\s*(\d+)/i.exec(s);
      if (m) {
        const lim = m[2] === '<' ? +m[3] - 1 : +m[3];
        s = s.slice(0, m.index) + (U(m[1]) === 'WHERE' ? ' WHERE 1=1' : '') + s.slice(m.index + m[0].length);
        s = s.replace(/\bWHERE\s+1=1\s+AND\b/i, 'WHERE');
        s = s.replace(/\s+WHERE\s+1=1\s*$/i, '').replace(/\s+WHERE\s+1=1(\s+(?:GROUP|ORDER|HAVING))/i, '$1');
        s += ' LIMIT ' + lim;
      }
    }

    // ---- DDL
    s = translateDDL(s, dialect, lits, notes);

    // ---- MaxCompute / Hive INSERT
    let extra = null;
    {
      const re = new RegExp('^INSERT\\s+(OVERWRITE|INTO)\\s+(?:TABLE\\s+)?(' + IDENT + ')\\s*(?:PARTITION\\s*\\(([^)]*)\\))?\\s*', 'i');
      const m = re.exec(s);
      if (m && (dialect === 'maxcompute' || dialect === 'hive' || /^INSERT\s+OVERWRITE/i.test(s) || /\bPARTITION\s*\(/i.test(m[0]) || /^INSERT\s+INTO\s+TABLE\b/i.test(s))) {
        const overwrite = U(m[1]) === 'OVERWRITE'; const tbl = m[2];
        let rest = s.slice(m[0].length);
        const parts = m[3] ? m[3].split(',').map(x => x.trim()).filter(Boolean) : [];
        const statics = parts.map(p => /^(\w+)\s*=\s*(.+)$/.exec(p)).filter(Boolean);
        let cols = '';
        const cm = /^\(([^()]*)\)\s*/.exec(rest);
        if (cm && !/^\(\s*SELECT\b/i.test(rest)) { cols = cm[1]; rest = rest.slice(cm[0].length); }
        let body;
        if (statics.length) {
          const vals = statics.map(x => x[2]).join(', ');
          body = 'INSERT INTO ' + tbl + (cols ? ' (' + cols + ', ' + statics.map(x => x[1]).join(', ') + ')' : '') + ' SELECT _p.*, ' + vals + ' FROM (' + rest + ') AS _p';
          if (!cols) notes.push('Static partition values are appended as the last column(s).');
        } else body = 'INSERT INTO ' + tbl + (cols ? ' (' + cols + ')' : '') + ' ' + rest;
        if (overwrite) {
          const where = statics.length ? ' WHERE ' + statics.map(x => x[1] + ' = ' + x[2]).join(' AND ') : '';
          extra = 'DELETE FROM ' + tbl + where;
        }
        s = body;
      }
    }

    // CTAS with LIFECYCLE etc.
    s = s.replace(/\bLIFECYCLE\s+\d+/gi, '');

    const result = [];
    if (extra) result.push(unmask(extra, lits));
    result.push(unmask(s, lits).trim());
    return { sql: result, notes };
  }

  function translateDDL(s, dialect, lits, notes) {
    const head = new RegExp('^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:GLOBAL\\s+|LOCAL\\s+)?TEMP(?:ORARY)?\\s+|EXTERNAL\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(' + IDENT + ')\\s*', 'i');
    const m = head.exec(s);
    if (!m) {
      if (dialect !== 'sqlite') {
        s = s.replace(/^(CREATE\s+(?:UNIQUE\s+)?)(?:CLUSTERED\s+|NONCLUSTERED\s+)?(INDEX\b[\s\S]*?)\s+USING\s+\w+/i, '$1$2');
        s = s.replace(/^(CREATE\s+(?:UNIQUE\s+)?)(?:CLUSTERED\s+|NONCLUSTERED\s+)(INDEX\b)/i, '$1$2');
        s = s.replace(/^ALTER\s+TABLE\s+(\S+)\s+ADD\s+(?!COLUMN\b|CONSTRAINT\b|PRIMARY\b|UNIQUE\b|FOREIGN\b|INDEX\b|KEY\b)/i, 'ALTER TABLE $1 ADD COLUMN ');
        s = s.replace(/^ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMNS\s*\(([^)]*)\)\s*$/i, (x, t, c) => { const cs = splitArgs(c); if (cs.length > 1) notes.push('Only the first column of ADD COLUMNS is added.'); return 'ALTER TABLE ' + t + ' ADD COLUMN ' + cleanColumnType(cs[0], dialect); });
        s = s.replace(/^ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+([\s\S]+)$/i, (x, t, c) => 'ALTER TABLE ' + t + ' ADD COLUMN ' + cleanColumnType(c, dialect).replace(/\s+(FIRST|AFTER\s+\S+)\s*$/i, ''));
        s = s.replace(/^ALTER\s+TABLE\s+(\S+)\s+RENAME\s+TO\s+/i, 'ALTER TABLE $1 RENAME TO ');
        s = s.replace(/^TRUNCATE\s+TABLE\s+(\S+)/i, 'DELETE FROM $1');
        s = s.replace(/^TRUNCATE\s+(\S+)/i, 'DELETE FROM $1');
        s = s.replace(/^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(\S+)\s+(PURGE|CASCADE(\s+CONSTRAINTS)?|RESTRICT)\s*$/i, 'DROP TABLE $1$2');
        s = s.replace(/^(CREATE\s+(?:OR\s+REPLACE\s+)?)VIEW\b/i, (x) => /REPLACE/i.test(x) ? 'CREATE VIEW' : x);
        if (/^CREATE\s+OR\s+REPLACE\s+VIEW/i.test(s)) s = s.replace(/^CREATE\s+OR\s+REPLACE\s+VIEW/i, 'CREATE VIEW');
      }
      return s;
    }
    if (dialect === 'sqlite') return s;
    const name = m[1];
    let rest = s.slice(m[0].length);
    if (!rest.startsWith('(')) {
      // CTAS / LIKE
      rest = rest.replace(/^(?:COMMENT\s+\S+\s*|LIFECYCLE\s+\d+\s*|STORED\s+AS\s+\w+\s*)*/i, '');
      const lk = new RegExp('^LIKE\\s+(' + IDENT + ')', 'i').exec(rest);
      if (lk) return 'CREATE TABLE ' + name + ' AS SELECT * FROM ' + lk[1] + ' WHERE 0';
      return 'CREATE TABLE ' + name + ' ' + rest;
    }
    let depth = 0, j = 0;
    for (; j < rest.length; j++) { if (rest[j] === '(') depth++; else if (rest[j] === ')') { depth--; if (depth === 0) break; } }
    const body = rest.slice(1, j);
    let tail = rest.slice(j + 1);
    let defs = splitArgs(body);
    const pm = /PARTITIONED\s+BY\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/i.exec(tail);
    if (pm) { defs = defs.concat(splitArgs(pm[1])); notes.push('Partition columns are created as regular columns.'); }
    const asSelect = /\bAS\s+(SELECT|WITH)\b[\s\S]*$/i.exec(tail);
    let autoCol = null;
    const outDefs = [];
    for (let d0 of defs) {
      let d = d0.trim(); if (!d) continue;
      // table constraints / indexes
      if (/^(FULLTEXT|SPATIAL)\s+(KEY|INDEX)\b/i.test(d)) continue;
      let km;
      if ((km = /^UNIQUE\s+(?:KEY|INDEX)\s*(?:\S+\s*)?\(([^)]*)\)/i.exec(d))) { outDefs.push('UNIQUE (' + km[1].replace(/\(\d+\)/g, '') + ')'); continue; }
      if (/^(KEY|INDEX)\b/i.test(d)) continue;
      if (/^(CONSTRAINT\s+\S+\s+)?(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(d)) {
        const pk = /PRIMARY\s+KEY\s*(?:CLUSTERED\s+|NONCLUSTERED\s+)?\(([^)]*)\)/i.exec(d);
        if (pk && autoCol && pk[1].trim().replace(/["`]/g, '').toLowerCase() === autoCol) continue;
        outDefs.push(d.replace(/\s+(CLUSTERED|NONCLUSTERED)\b/gi, '').replace(/\s+USING\s+\w+/gi, '').replace(/\s+NOT\s+ENFORCED\b/gi, ''));
        continue;
      }
      // column definition
      const cm = new RegExp('^(' + IDP + '|[\\w$]+)\\s*([\\s\\S]*)$').exec(d);
      if (!cm) { outDefs.push(d); continue; }
      const col = cm[1]; let rest2 = cm[2];
      const colName = (litValue(col, lits) ?? col).toLowerCase();
      const isAuto = /\bAUTO_?INCREMENT\b|\bIDENTITY\b|\bGENERATED\s+(ALWAYS|BY\s+DEFAULT)(\s+ON\s+NULL)?\s+AS\s+IDENTITY\b|^(BIG|SMALL)?SERIAL\d?\b/i.test(rest2);
      if (isAuto && !autoCol) {
        autoCol = colName;
        outDefs.push(col + ' INTEGER PRIMARY KEY AUTOINCREMENT');
        continue;
      }
      outDefs.push(col + ' ' + cleanColumnType(rest2, dialect));
    }
    // remove separate PK on auto column if it came before
    const finalDefs = outDefs.filter(d => {
      const pk = /^(CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(d);
      return !(pk && autoCol && pk[2].trim().replace(/["`]/g, '').toLowerCase() === autoCol);
    });
    if (/\bSTORED\s+AS\b|\bLIFECYCLE\b|\bENGINE\s*=|\bTBLPROPERTIES\b|\bCLUSTERED\s+BY\b|\bROW\s+FORMAT\b/i.test(tail)) { /* options dropped */ }
    tail = asSelect ? ' ' + asSelect[0] : '';
    return 'CREATE TABLE ' + (/IF\s+NOT\s+EXISTS/i.test(m[0]) ? 'IF NOT EXISTS ' : '') + name + ' (\n  ' + finalDefs.join(',\n  ') + '\n)' + tail;
  }

  function cleanColumnType(d, dialect) {
    let r = ' ' + d + ' ';
    r = r.replace(/\b(ARRAY|MAP|STRUCT)\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>/gi, 'TEXT');
    r = r.replace(/\bSTRING\b/gi, 'TEXT');
    r = r.replace(/\b(ENUM|SET)\s*\([^)]*\)/gi, 'TEXT');
    r = r.replace(/\bN?VARCHAR\s*\(\s*MAX\s*\)/gi, 'TEXT');
    r = r.replace(/\b(\w+)\s*\[\s*\]/g, 'TEXT');
    r = r.replace(/\b(UNSIGNED|ZEROFILL|SIGNED)\b/gi, '');
    r = r.replace(/\bCHARACTER\s+SET\s+\w+|\bCHARSET\s+\w+|\bCOLLATE\s+\S+/gi, '');
    r = r.replace(new RegExp('\\bCOMMENT\\s+(' + STR + ')', 'gi'), '');
    r = r.replace(/\bON\s+UPDATE\s+(NOW\(\)|CURRENT_TIMESTAMP(\(\d*\))?)/gi, '');
    r = r.replace(/\bDEFAULT\s+([A-Za-z_]\w*\s*\([^()]*\))/gi, 'DEFAULT ($1)');
    r = r.replace(/\b(CLUSTERED|NONCLUSTERED)\b/gi, '');
    r = r.replace(/\bWITH\s+TIME\s+ZONE\b|\bWITHOUT\s+TIME\s+ZONE\b/gi, '');
    return r.replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- date utils
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  function nowLocal() { const d = new Date(); return { t: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()), time: true }; }
  function pd(v) {
    if (v == null) return null;
    if (typeof v === 'number') { const d = new Date(v * 1000); return { t: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()), time: true }; }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/.exec(s);
    if (!m) m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(s);
    if (!m) m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) { const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s); if (tm) return { t: Date.UTC(1970, 0, 1, +tm[1], +tm[2], +(tm[3] || 0)), time: true }; return null; }
    return { t: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), time: m[4] != null };
  }
  function fmt(t, time) { const d = new Date(t); const ds = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); return time ? ds + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) : ds; }
  function unitOf(u) {
    u = String(u || 'day').toLowerCase().replace(/s$/, '').trim();
    const map = { yyyy: 'year', yy: 'year', y: 'year', year: 'year', mm: 'month', m: 'month', mon: 'month', month: 'month', dd: 'day', d: 'day', day: 'day', dy: 'day', dayofyear: 'day', hh: 'hour', h: 'hour', hour: 'hour', hh24: 'hour', mi: 'minute', n: 'minute', minute: 'minute', min: 'minute', ss: 'second', s: 'second', second: 'second', sec: 'second', ff3: 'ms', ms: 'ms', millisecond: 'ms', week: 'week', wk: 'week', ww: 'week', w: 'week', iw: 'week', quarter: 'quarter', qq: 'quarter', q: 'quarter', microsecond: 'ms', weekday: 'weekday', dw: 'weekday', dow: 'dow', doy: 'doy', isodow: 'isodow', epoch: 'epoch', decade: 'decade', century: 'century' };
    return map[u] || u;
  }
  function addUnit(t, n, unit) {
    const d = new Date(t); n = Number(n);
    switch (unitOf(unit)) {
      case 'year': n *= 12; // fallthrough
      case 'quarter': if (unitOf(unit) === 'quarter') n *= 3; // fallthrough
      case 'month': {
        const y = d.getUTCFullYear(), mo = d.getUTCMonth() + n, day = d.getUTCDate();
        const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        return Date.UTC(y, mo, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
      }
      case 'week': return t + n * 7 * 864e5;
      case 'day': return t + n * 864e5;
      case 'hour': return t + n * 36e5;
      case 'minute': return t + n * 6e4;
      case 'second': return t + n * 1e3;
      case 'ms': return t + n;
      default: throw new Error('Unknown date unit: ' + unit);
    }
  }
  const timeUnit = (u) => ['hour', 'minute', 'second', 'ms'].includes(unitOf(u));
  function truncTo(t, unit) {
    const d = new Date(t); const y = d.getUTCFullYear(), mo = d.getUTCMonth();
    switch (unitOf(unit)) {
      case 'year': return Date.UTC(y, 0, 1);
      case 'quarter': return Date.UTC(y, mo - mo % 3, 1);
      case 'month': return Date.UTC(y, mo, 1);
      case 'week': { const dow = (d.getUTCDay() + 6) % 7; return Date.UTC(y, mo, d.getUTCDate() - dow); }
      case 'day': return Date.UTC(y, mo, d.getUTCDate());
      case 'hour': return Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours());
      case 'minute': return Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
      case 'second': return Math.floor(t / 1000) * 1000;
      default: throw new Error('Unknown date unit: ' + unit);
    }
  }
  function diffUnits(a, b, unit) { // boundaries crossed from b to a  (a - b)
    const u = unitOf(unit);
    const da = new Date(a), db = new Date(b);
    if (u === 'year') return da.getUTCFullYear() - db.getUTCFullYear();
    if (u === 'quarter') return (da.getUTCFullYear() - db.getUTCFullYear()) * 4 + Math.floor(da.getUTCMonth() / 3) - Math.floor(db.getUTCMonth() / 3);
    if (u === 'month') return (da.getUTCFullYear() - db.getUTCFullYear()) * 12 + da.getUTCMonth() - db.getUTCMonth();
    const div = { week: 6048e5, day: 864e5, hour: 36e5, minute: 6e4, second: 1e3, ms: 1 }[u];
    if (!div) throw new Error('Unknown date unit: ' + unit);
    return Math.round((truncTo(a, u === 'ms' ? 'second' : u) - truncTo(b, u === 'ms' ? 'second' : u)) / div) + (u === 'ms' ? (a % 1000) - (b % 1000) : 0);
  }
  function elapsedUnits(a, b, unit) { // full units elapsed from a to b (MySQL TIMESTAMPDIFF)
    const u = unitOf(unit);
    if (['month', 'quarter', 'year'].includes(u)) {
      let m = diffUnits(b, a, 'month');
      if (m > 0 && addUnit(a, m, 'month') > b) m--; else if (m < 0 && addUnit(a, m, 'month') < b) m++;
      return u === 'month' ? m : Math.trunc(m / (u === 'year' ? 12 : 3));
    }
    const div = { week: 6048e5, day: 864e5, hour: 36e5, minute: 6e4, second: 1e3, ms: 1 }[u];
    return Math.trunc((b - a) / div);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function dayOfYear(d) { return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; }
  function isoWeek(d) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); }
  function mysqlFormat(t, f) {
    const d = new Date(t); const H = d.getUTCHours(), h12 = (H % 12) || 12;
    return f.replace(/%([a-zA-Z%])/g, (m, c) => ({
      Y: d.getUTCFullYear(), y: pad(d.getUTCFullYear() % 100), m: pad(d.getUTCMonth() + 1), c: d.getUTCMonth() + 1, d: pad(d.getUTCDate()), e: d.getUTCDate(),
      H: pad(H), k: H, h: pad(h12), I: pad(h12), l: h12, i: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()), S: pad(d.getUTCSeconds()), p: H < 12 ? 'AM' : 'PM',
      M: MONTHS[d.getUTCMonth()], b: MONTHS[d.getUTCMonth()].slice(0, 3), W: DAYS[d.getUTCDay()], a: DAYS[d.getUTCDay()].slice(0, 3), j: pad(dayOfYear(d), 3), w: d.getUTCDay(),
      T: pad(H) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()), r: pad(h12) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + (H < 12 ? ' AM' : ' PM'),
      D: d.getUTCDate() + (['th', 'st', 'nd', 'rd'][(d.getUTCDate() % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][d.getUTCDate() % 100] || 'th'), u: pad(isoWeek(d)), v: pad(isoWeek(d)), f: '000000', '%': '%',
    })[c] ?? m);
  }
  function oracleFormat(t, f) { // YYYY-MM-DD HH24:MI:SS (also MaxCompute yyyy-mm-dd hh:mi:ss)
    const d = new Date(t); const H = d.getUTCHours(); const pm = /AM|PM|A\.M\.|P\.M\./i.test(f);
    return f.replace(/YYYY|YYY|YY|MONTH|Month|month|MON|Mon|mon|MM|DDD|DD|DY|Dy|dy|DAY|Day|day|HH24|HH12|HH|MI|SS|FF3|FF|AM|PM|Q|IW|WW|D/gi, (tok) => {
      const T = tok.toUpperCase();
      const cap = (s) => tok === T ? s.toUpperCase() : tok[0] === T[0] && tok[1] !== T[1] ? s : s.toLowerCase();
      switch (T) {
        case 'YYYY': return d.getUTCFullYear(); case 'YYY': return String(d.getUTCFullYear()).slice(-3); case 'YY': return pad(d.getUTCFullYear() % 100);
        case 'MONTH': return cap(MONTHS[d.getUTCMonth()]); case 'MON': return cap(MONTHS[d.getUTCMonth()].slice(0, 3));
        case 'MM': return pad(d.getUTCMonth() + 1); case 'DDD': return pad(dayOfYear(d), 3); case 'DD': return pad(d.getUTCDate());
        case 'DY': return cap(DAYS[d.getUTCDay()].slice(0, 3)); case 'DAY': return cap(DAYS[d.getUTCDay()]); case 'D': return d.getUTCDay() + 1;
        case 'HH24': return pad(H); case 'HH12': return pad((H % 12) || 12); case 'HH': return pm ? pad((H % 12) || 12) : pad(H);
        case 'MI': return pad(d.getUTCMinutes()); case 'SS': return pad(d.getUTCSeconds()); case 'FF3': case 'FF': return '000';
        case 'AM': case 'PM': return H < 12 ? 'AM' : 'PM'; case 'Q': return Math.floor(d.getUTCMonth() / 3) + 1; case 'IW': case 'WW': return pad(isoWeek(d));
      }
      return tok;
    });
  }
  function javaFormat(t, f) { // yyyy-MM-dd HH:mm:ss
    const d = new Date(t); const H = d.getUTCHours();
    return f.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|EEEE|EEE|E|a|u/g, (tok) => ({
      yyyy: d.getUTCFullYear(), yy: pad(d.getUTCFullYear() % 100), MMMM: MONTHS[d.getUTCMonth()], MMM: MONTHS[d.getUTCMonth()].slice(0, 3), MM: pad(d.getUTCMonth() + 1), M: d.getUTCMonth() + 1,
      dd: pad(d.getUTCDate()), d: d.getUTCDate(), HH: pad(H), H: H, hh: pad((H % 12) || 12), h: (H % 12) || 12, mm: pad(d.getUTCMinutes()), m: d.getUTCMinutes(), ss: pad(d.getUTCSeconds()), s: d.getUTCSeconds(),
      SSS: '000', EEEE: DAYS[d.getUTCDay()], EEE: DAYS[d.getUTCDay()].slice(0, 3), E: DAYS[d.getUTCDay()].slice(0, 3), a: H < 12 ? 'AM' : 'PM', u: d.getUTCDay() || 7,
    })[tok]);
  }
  function parseWithFormat(s, f) {
    if (f == null) { const p = pd(s); return p; }
    const order = []; let re = '';
    const toks = /YYYY|yyyy|MM|mm|DD|dd|HH24|HH|hh|MI|mi|SS|ss|[^A-Za-z]+|[A-Za-z]/g; let m;
    const javaish = /HH|mm:ss|MM-dd|MM\/dd/.test(f) && /dd/.test(f) && !/mi/i.test(f);
    while ((m = toks.exec(f))) {
      const t = m[0];
      if (/^(YYYY|yyyy)$/.test(t)) { order.push('y'); re += '(\\d{4})'; }
      else if (t === 'MM' || (t === 'mm' && !javaish)) { order.push('mo'); re += '(\\d{1,2})'; }
      else if (t === 'mm' && javaish) { order.push('mi'); re += '(\\d{1,2})'; }
      else if (/^(DD|dd)$/.test(t)) { order.push('d'); re += '(\\d{1,2})'; }
      else if (/^(HH24|HH|hh)$/.test(t)) { order.push('h'); re += '(\\d{1,2})'; }
      else if (/^(MI|mi)$/.test(t)) { order.push('mi'); re += '(\\d{1,2})'; }
      else if (/^(SS|ss)$/.test(t)) { order.push('s'); re += '(\\d{1,2})'; }
      else re += t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const r = new RegExp('^\\s*' + re).exec(String(s));
    if (!r) return null;
    const v = { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0 }; order.forEach((k, i) => v[k] = +r[i + 1]);
    return { t: Date.UTC(v.y, v.mo - 1, v.d, v.h, v.mi, v.s), time: order.some(k => ['h', 'mi', 's'].includes(k)) };
  }

  // ---------------------------------------------------------------- md5
  function md5(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const len = bytes.length, nBlk = ((len + 8) >> 6) + 1, w = new Uint32Array(nBlk * 16);
    for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
    w[len >> 2] |= 0x80 << ((len % 4) * 8); w[nBlk * 16 - 2] = (len * 8) >>> 0; w[nBlk * 16 - 1] = Math.floor(len / 536870912) >>> 0;
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let o = 0; o < w.length; o += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g; const r = i >> 4;
        if (r === 0) { F = (B & C) | (~B & D); g = i; } else if (r === 1) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (r === 2) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const tmp = D; D = C; C = B;
        const x = (A + F + K[i] + w[o + g]) >>> 0, sh = S[r * 4 + (i % 4)];
        B = (B + ((x << sh) | (x >>> (32 - sh)))) >>> 0; A = tmp;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(s => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }

  // ---------------------------------------------------------------- function registry
  function registerFunctions(db) {
    const reg = (names, fn, arities) => {
      for (const name of names.split('|')) for (const n of arities) {
        const f = function () { return fn.apply(null, arguments); };
        Object.defineProperty(f, 'length', { value: n });
        db.create_function(name, f);
      }
    };
    const D = (v) => { const p = pd(v); return p; };
    const nn = (f) => function () { for (const a of arguments) if (a == null) return null; return f.apply(null, arguments); };
    const r = (fn) => (x) => (x == null ? null : fn(Number(x)));

    reg('NOW|SYSDATE|GETDATE|SYSDATETIME|LOCALTIMESTAMP|CURRENT_DATETIME|LOCALTIME', () => fmt(nowLocal().t, true), [0]);
    reg('GETUTCDATE|UTC_TIMESTAMP', () => fmt(Date.now() - (Date.now() % 1000), true), [0]);
    reg('CURDATE|TODAY', () => fmt(nowLocal().t, false), [0]);
    reg('CURTIME', () => fmt(nowLocal().t, true).slice(11), [0]);
    reg('UNIX_TIMESTAMP', (v) => { if (v === undefined) return Math.floor(Date.now() / 1000); const p = D(v); if (!p) return null; const d = new Date(p.t); return Math.floor(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime() / 1000); }, [0, 1]);
    reg('FROM_UNIXTIME|TO_TIMESTAMP', (n, f) => { if (n == null) return null; if (typeof n === 'string' && isNaN(+n)) { const p = f ? parseWithFormat(n, f) : pd(n); return p ? fmt(p.t, true) : null; } const p = pd(Number(n)); return f ? (f.includes('%') ? mysqlFormat(p.t, f) : javaFormat(p.t, f)) : fmt(p.t, true); }, [1, 2]);
    reg('YEAR', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCFullYear() : null; }), [1]);
    reg('MONTH', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCMonth() + 1 : null; }), [1]);
    reg('DAY|DAYOFMONTH', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCDate() : null; }), [1]);
    reg('HOUR', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCHours() : null; }), [1]);
    reg('MINUTE', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCMinutes() : null; }), [1]);
    reg('SECOND', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCSeconds() : null; }), [1]);
    reg('QUARTER', nn((v) => { const p = D(v); return p ? Math.floor(new Date(p.t).getUTCMonth() / 3) + 1 : null; }), [1]);
    reg('DAYOFWEEK', nn((v) => { const p = D(v); return p ? new Date(p.t).getUTCDay() + 1 : null; }), [1]);
    reg('WEEKDAY', nn((v) => { const p = D(v); return p ? (new Date(p.t).getUTCDay() + 6) % 7 : null; }), [1]);
    reg('DAYOFYEAR', nn((v) => { const p = D(v); return p ? dayOfYear(new Date(p.t)) : null; }), [1]);
    reg('WEEKOFYEAR|WEEK|ISOWEEK', nn((v) => { const p = D(v); return p ? isoWeek(new Date(p.t)) : null; }), [1, 2]);
    reg('MONTHNAME', nn((v) => { const p = D(v); return p ? MONTHS[new Date(p.t).getUTCMonth()] : null; }), [1]);
    reg('DAYNAME', nn((v) => { const p = D(v); return p ? DAYS[new Date(p.t).getUTCDay()] : null; }), [1]);
    reg('LAST_DAY|LASTDAY|EOMONTH', nn((v, n) => { const p = D(v); if (!p) return null; const d = new Date(addUnit(p.t, n || 0, 'month')); return fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0), false); }), [1, 2]);
    reg('ADD_MONTHS', nn((v, n) => { const p = D(v); return p ? fmt(addUnit(p.t, n, 'month'), p.time) : null; }), [2]);
    reg('MONTHS_BETWEEN', nn((a, b) => { const pa = D(a), pb = D(b); if (!pa || !pb) return null; const da = new Date(pa.t), db_ = new Date(pb.t); return Math.round(((da.getUTCFullYear() - db_.getUTCFullYear()) * 12 + da.getUTCMonth() - db_.getUTCMonth() + (da.getUTCDate() - db_.getUTCDate()) / 31) * 1e6) / 1e6; }), [2]);
    reg('EXTRACT_PART', nn((u, v) => {
      const p = D(v); if (!p) return null; const d = new Date(p.t);
      switch (unitOf(u)) {
        case 'year': return d.getUTCFullYear(); case 'quarter': return Math.floor(d.getUTCMonth() / 3) + 1; case 'month': return d.getUTCMonth() + 1;
        case 'week': return isoWeek(d); case 'day': return /dayofyear|dy|doy/i.test(u) ? dayOfYear(d) : d.getUTCDate(); case 'hour': return d.getUTCHours();
        case 'minute': return d.getUTCMinutes(); case 'second': return d.getUTCSeconds(); case 'dow': return d.getUTCDay(); case 'isodow': return d.getUTCDay() || 7;
        case 'weekday': return d.getUTCDay() + 1; case 'doy': return dayOfYear(d); case 'epoch': return Math.floor(p.t / 1000);
        case 'decade': return Math.floor(d.getUTCFullYear() / 10); case 'century': return Math.ceil(d.getUTCFullYear() / 100); case 'ms': return d.getUTCSeconds() * 1000;
      }
      throw new Error('Unknown date part: ' + u);
    }), [2]);
    reg('TSQL_DATENAME', nn((u, v) => { const p = D(v); if (!p) return null; const d = new Date(p.t); const uu = unitOf(u); if (uu === 'month') return MONTHS[d.getUTCMonth()]; if (uu === 'weekday') return DAYS[d.getUTCDay()]; return String(({ year: d.getUTCFullYear(), day: d.getUTCDate(), quarter: Math.floor(d.getUTCMonth() / 3) + 1, hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), week: isoWeek(d) })[uu] ?? ''); }), [2]);
    reg('INTERVAL_ADD', nn((v, sign, iv) => {
      const p = D(v); if (!p) return null; let t = p.t, time = p.time;
      const re = /(-?\d+(?:\.\d+)?)\s*([a-z]+)/gi; let m, any = false;
      while ((m = re.exec(String(iv)))) { any = true; const n = (sign === '-' ? -1 : 1) * Number(m[1]); t = addUnit(t, n, m[2]); if (timeUnit(m[2])) time = true; }
      if (!any) { const n = Number(iv); if (!isNaN(n)) t = addUnit(t, (sign === '-' ? -1 : 1) * n, 'day'); }
      return fmt(t, time);
    }), [3]);
    // DATEADD(d, n, unit) MaxCompute
    reg('DATEADD', nn((v, n, u) => { const p = D(v); if (!p) return null; return fmt(addUnit(p.t, n, u), p.time || timeUnit(u) || CURRENT === 'maxcompute'); }), [3]);
    reg('TSQL_DATEADD', nn((u, n, v) => { const p = D(v); if (!p) return null; return fmt(addUnit(p.t, n, u), true); }), [3]);
    reg('TIMESTAMPADD', nn((u, n, v) => { const p = D(v); if (!p) return null; return fmt(addUnit(p.t, n, u), p.time || timeUnit(u)); }), [3]);
    // DATEDIFF(a,b) days (MySQL/Hive) ; DATEDIFF(a,b,unit) MaxCompute
    reg('DATEDIFF', (a, b, u) => { if (a == null || b == null) return null; const pa = D(a), pb = D(b); if (!pa || !pb) return null; return diffUnits(pa.t, pb.t, u || 'day'); }, [2, 3]);
    reg('TSQL_DATEDIFF', nn((u, a, b) => { const pa = D(a), pb = D(b); if (!pa || !pb) return null; return diffUnits(pb.t, pa.t, u); }), [3]);
    reg('TIMESTAMPDIFF', nn((u, a, b) => { const pa = D(a), pb = D(b); if (!pa || !pb) return null; return elapsedUnits(pa.t, pb.t, u); }), [3]);
    reg('DATE_TRUNC', nn((u, v) => { const p = D(v); if (!p) return null; return fmt(truncTo(p.t, u), true); }), [2]);
    reg('DATETRUNC', nn((v, u) => { const p = D(v); if (!p) return null; return fmt(truncTo(p.t, u), true); }), [2]);
    reg('DATEPART', nn((v, u) => { const p = D(v); if (!p) return null; const d = new Date(p.t); return ({ year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) + 1, month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), week: isoWeek(d) })[unitOf(u)]; }), [2]);
    reg('TRUNC|TRUNCATE', (v, f) => {
      if (v == null) return null;
      if (typeof v === 'string' && pd(v) && isNaN(+v)) { const p = pd(v); return fmt(truncTo(p.t, f == null ? 'day' : { MM: 'month', MON: 'month', MONTH: 'month', YYYY: 'year', YEAR: 'year', YY: 'year', Q: 'quarter', DD: 'day', DAY: 'day', HH: 'hour', HH24: 'hour', MI: 'minute', IW: 'week' }[String(f).toUpperCase()] || f), false); }
      const k = Math.pow(10, Number(f || 0)); return Math.trunc(Number(v) * k) / k;
    }, [1, 2]);
    reg('DATE_FORMAT|FORMAT_DATETIME', nn((v, f) => { const p = D(v); if (!p) return null; return f.includes('%') ? mysqlFormat(p.t, f) : javaFormat(p.t, f); }), [2]);
    reg('TO_CHAR', (v, f) => {
      if (v == null) return null;
      if (f == null) return String(v);
      const p = typeof v === 'string' ? pd(v) : null;
      if (p) return oracleFormat(p.t, f);
      // numeric format: count decimals after '.'
      const dm = /\.(0+|9+)/.exec(f); const n = Number(v);
      let s = dm ? n.toFixed(dm[1].length) : String(Math.round(n));
      if (/[,G]/.test(f)) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/(\.\d*?),/g, '$1');
      return s;
    }, [1, 2]);
    reg('FORMAT', (v, f, loc) => {
      if (v == null) return null;
      if (typeof f === 'number' || (f != null && /^\d+$/.test(String(f)))) return Number(v).toLocaleString('en-US', { minimumFractionDigits: +f, maximumFractionDigits: +f });
      const p = pd(v); if (p && typeof f === 'string') return javaFormat(p.t, f);
      return String(v);
    }, [2, 3]);
    reg('TO_DATE|STR_TO_DATE|PARSE_DATE', (s, f) => {
      if (s == null) return null;
      let p;
      if (f && f.includes('%')) { const jf = f.replace(/%Y/g, 'yyyy').replace(/%m|%c/g, 'MM').replace(/%d|%e/g, 'dd').replace(/%H|%k/g, 'HH').replace(/%i/g, 'MI').replace(/%s|%S/g, 'SS'); p = parseWithFormat(s, jf); }
      else p = parseWithFormat(s, f);
      return p ? fmt(p.t, p.time && CURRENT !== 'hive') : null;
    }, [1, 2]);
    reg('ISDATE', (s) => (s != null && pd(s) ? 1 : 0), [1, 2]);

    // strings
    reg('NVL|ISNULL', (a, b) => (a == null ? b : a), [2]);
    reg('LEN|CHAR_LENGTH|CHARACTER_LENGTH', nn((s) => String(s).replace(/\s+$/, CURRENT === 'mssql' ? '' : '$&').length), [1]);
    reg('CHARINDEX', nn((sub, s, st) => { const i = String(s).indexOf(String(sub), st ? st - 1 : 0); return i + 1; }), [2, 3]);
    reg('LOCATE', nn((sub, s, st) => String(s).indexOf(String(sub), st ? st - 1 : 0) + 1), [2, 3]);
    reg('STR_LEFT', nn((s, n) => String(s).slice(0, Math.max(0, n))), [2]);
    reg('STR_RIGHT', nn((s, n) => (n <= 0 ? '' : String(s).slice(-n))), [2]);
    reg('LPAD', nn((s, n, p) => { s = String(s); p = p == null ? ' ' : String(p); if (s.length >= n) return s.slice(0, n); return s.padStart(n, p); }), [2, 3]);
    reg('RPAD', nn((s, n, p) => { s = String(s); p = p == null ? ' ' : String(p); if (s.length >= n) return s.slice(0, n); return s.padEnd(n, p); }), [2, 3]);
    reg('REVERSE', nn((s) => [...String(s)].reverse().join('')), [1]);
    reg('REPEAT|REPLICATE', nn((s, n) => String(s).repeat(Math.max(0, n))), [2]);
    reg('SPACE', nn((n) => ' '.repeat(Math.max(0, n))), [1]);
    reg('INITCAP', nn((s) => String(s).toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (m, a, b) => a + b.toUpperCase())), [1]);
    reg('UCASE|TOUPPER', nn((s) => String(s).toUpperCase()), [1]);
    reg('LCASE|TOLOWER', nn((s) => String(s).toLowerCase()), [1]);
    reg('ASCII', nn((s) => String(s).charCodeAt(0) || 0), [1]);
    reg('CHR', nn((n) => String.fromCharCode(n)), [1]);
    reg('SPLIT_PART', nn((s, sep, n) => { const a = String(s).split(String(sep)); const i = n > 0 ? n - 1 : a.length + n; return a[i] ?? ''; }), [3]);
    reg('SUBSTRING_INDEX', nn((s, d, n) => { const a = String(s).split(String(d)); return n > 0 ? a.slice(0, n).join(d) : a.slice(n).join(d); }), [3]);
    reg('SPLIT', nn((s, sep) => JSON.stringify(String(s).split(new RegExp(sep)))), [2]);
    reg('MD5', nn((s) => md5(String(s))), [1]);
    reg('UUID|NEWID|GEN_RANDOM_UUID|UUID_GENERATE_V4', () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r_ = Math.random() * 16 | 0; return (c === 'x' ? r_ : (r_ & 3 | 8)).toString(16); }), [0]);
    reg('TO_NUMBER', nn((s) => Number(String(s).replace(/,/g, ''))), [1, 2]);
    reg('KEYVALUE', nn((s, d1, d2, key) => { for (const kv of String(s).split(d1)) { const i = kv.indexOf(d2); if (i >= 0 && kv.slice(0, i) === key) return kv.slice(i + d2.length); } return null; }), [4]);
    reg('BIN', nn((n) => Math.trunc(n).toString(2)), [1]);
    reg('HEX_STR|CONV', nn((n, a, b) => parseInt(String(n), a).toString(b).toUpperCase()), [3]);

    // regex
    const rx = (p, flags = '') => new RegExp(String(p).replace(/\(\?i\)/, ''), flags + (/\(\?i\)/.test(p) ? 'i' : ''));
    reg('REGEXP', (p, v) => (v == null || p == null ? null : rx(p).test(String(v)) ? 1 : 0), [2]);
    reg('REGEXP_LIKE', (v, p, f) => (v == null || p == null ? null : rx(p, f && f.includes('i') ? 'i' : '').test(String(v)) ? 1 : 0), [2, 3]);
    reg('REGEXP_REPLACE', nn((v, p, rep) => String(v).replace(rx(p, 'g'), String(rep).replace(/\\(\d)/g, '$$$1'))), [3, 4]);
    reg('REGEXP_EXTRACT|REGEXP_SUBSTR', (v, p, i) => { if (v == null || p == null) return null; const m = rx(p).exec(String(v)); if (!m) return CURRENT === 'hive' ? '' : null; const idx = i == null ? (m.length > 1 ? 1 : 0) : Number(i); return m[idx] ?? null; }, [2, 3]);
    reg('REGEXP_COUNT', nn((v, p) => (String(v).match(rx(p, 'g')) || []).length), [2]);
    reg('REGEXP_INSTR', nn((v, p) => { const m = rx(p).exec(String(v)); return m ? m.index + 1 : 0; }), [2]);

    // math
    reg('SQRT', r(Math.sqrt), [1]); reg('EXP', r(Math.exp), [1]); reg('LN', r(Math.log), [1]);
    reg('LOG', (a, b) => { if (a == null) return null; if (b === undefined) return CURRENT === 'postgres' ? Math.log10(a) : Math.log(a); return CURRENT === 'mssql' ? Math.log(a) / Math.log(b) : Math.log(b) / Math.log(a); }, [1, 2]);
    reg('LOG10', r(Math.log10), [1]); reg('LOG2', r(Math.log2), [1]);
    reg('POW|POWER', nn((a, b) => Math.pow(a, b)), [2]);
    reg('FLOOR', r(Math.floor), [1]); reg('CEIL|CEILING', r(Math.ceil), [1]);
    reg('SIGN', r(Math.sign), [1]); reg('CBRT', r(Math.cbrt), [1]);
    reg('SIN', r(Math.sin), [1]); reg('COS', r(Math.cos), [1]); reg('TAN', r(Math.tan), [1]);
    reg('ASIN', r(Math.asin), [1]); reg('ACOS', r(Math.acos), [1]); reg('ATAN', r(Math.atan), [1]);
    reg('ATAN2|ATN2', nn((a, b) => Math.atan2(a, b)), [2]);
    reg('DEGREES', r((x) => x * 180 / Math.PI), [1]); reg('RADIANS', r((x) => x * Math.PI / 180), [1]);
    reg('PI', () => Math.PI, [0]);
    reg('MOD', nn((a, b) => a % b), [2]);
    reg('RAND', () => Math.random(), [0, 1]);
    reg('BITAND', nn((a, b) => a & b), [2]);
    reg('DIV', nn((a, b) => Math.trunc(a / b)), [2]);

    // aggregates
    if (db.create_aggregate) {
      const agg = (names, init, step, fin) => { for (const n of names.split('|')) db.create_aggregate(n, { init, step, finalize: fin }); };
      const variance = (sample) => (s) => { const xs = s.filter(x => x != null).map(Number); const n = xs.length; if (n < (sample ? 2 : 1)) return null; const mu = xs.reduce((a, b) => a + b, 0) / n; return xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (n - (sample ? 1 : 0)); };
      const sampleDefault = () => CURRENT === 'postgres' || CURRENT === 'oracle' || CURRENT === 'mssql';
      agg('STDDEV_POP|STDEVP', () => [], (s, v) => { s.push(v); return s; }, (s) => { const v = variance(false)(s || []); return v == null ? null : Math.sqrt(v); });
      agg('STDDEV_SAMP|STDEV', () => [], (s, v) => { s.push(v); return s; }, (s) => { const v = variance(true)(s || []); return v == null ? null : Math.sqrt(v); });
      agg('STDDEV|STD', () => [], (s, v) => { s.push(v); return s; }, (s) => { const v = variance(sampleDefault())(s || []); return v == null ? null : Math.sqrt(v); });
      agg('VAR_POP|VARP', () => [], (s, v) => { s.push(v); return s; }, (s) => variance(false)(s || []));
      agg('VAR_SAMP|VAR', () => [], (s, v) => { s.push(v); return s; }, (s) => variance(true)(s || []));
      agg('VARIANCE', () => [], (s, v) => { s.push(v); return s; }, (s) => variance(sampleDefault())(s || []));
      agg('MEDIAN', () => [], (s, v) => { if (v != null) s.push(Number(v)); return s; }, (s) => { if (!s || !s.length) return null; const a = s.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; });
      agg('PERCENTILE|PERCENTILE_APPROX|APPROX_PERCENTILE', () => ({ a: [], p: 0.5 }), (s, v, p) => { if (v != null) s.a.push(Number(v)); if (p != null) s.p = Number(p); return s; }, (s) => { if (!s || !s.a.length) return null; const a = s.a.slice().sort((x, y) => x - y); const pos = (a.length - 1) * s.p; const lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); });
      agg('BOOL_AND|EVERY', () => ({ v: null }), (s, v) => { if (v != null) s.v = (s.v ?? 1) && (v ? 1 : 0); return s; }, (s) => s ? s.v : null);
      agg('BOOL_OR', () => ({ v: null }), (s, v) => { if (v != null) s.v = (s.v ?? 0) || (v ? 1 : 0); return s; }, (s) => s ? s.v : null);
      agg('ANY_VALUE|ARBITRARY|FIRST', () => ({ v: null, set: false }), (s, v) => { if (!s.set) { s.v = v; s.set = true; } return s; }, (s) => s ? s.v : null);
      agg('COUNT_IF|COUNTIF', () => ({ n: 0 }), (s, v) => { if (v) s.n++; return s; }, (s) => s ? s.n : 0);
    }
  }

  // ---------------------------------------------------------------- sample data
  function seed(db, which) {
    let st = 20260518;
    const rnd = () => { st = (st * 1664525 + 1013904223) % 4294967296; return st / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const dt = (y, m, d, h = 0, mi = 0, s = 0) => fmt(Date.UTC(y, m - 1, d, h, mi, s), true);
    const dateOnly = (t) => fmt(t, false);
    const run = (sql, rows) => { const s = db.prepare(sql); for (const r_ of rows) s.run(r_); s.free(); };
    const FIRST = ['Ana', 'Ben', 'Carla', 'Diego', 'Elena', 'Farah', 'Gabe', 'Hana', 'Ivan', 'Jia', 'Kofi', 'Lena', 'Marco', 'Nina', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wen', 'Xavi', 'Yuki', 'Zara', 'Paolo', 'Mika', 'Leo', 'Ines'];
    const LAST = ['Santos', 'Reyes', 'Cruz', 'Lim', 'Garcia', 'Tan', 'Mendoza', 'Kim', 'Novak', 'Okafor', 'Patel', 'Silva', 'Wong', 'Rossi', 'Muller', 'Dubois', 'Ito', 'Chen', 'Lopez', 'Khan'];

    if (which === 'company' || which === 'all') {
      db.run(`CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL, location TEXT, budget REAL);
CREATE TABLE employees (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT UNIQUE, department_id INTEGER REFERENCES departments(id), manager_id INTEGER REFERENCES employees(id), title TEXT, salary REAL, hire_date DATE, is_active INTEGER DEFAULT 1);
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, department_id INTEGER REFERENCES departments(id), start_date DATE, end_date DATE, budget REAL);
CREATE TABLE employee_projects (employee_id INTEGER REFERENCES employees(id), project_id INTEGER REFERENCES projects(id), role TEXT, hours REAL, PRIMARY KEY (employee_id, project_id));`);
      const depts = [[1, 'Engineering', 'Manila', 1200000], [2, 'Customer Support', 'Cebu', 650000], [3, 'Sales', 'Singapore', 800000], [4, 'Marketing', 'Manila', 420000], [5, 'Finance', 'Hong Kong', 380000], [6, 'People Ops', 'Manila', 260000]];
      run('INSERT INTO departments VALUES (?,?,?,?)', depts);
      const titles = { 1: ['Software Engineer', 'Senior Engineer', 'QA Analyst', 'DevOps Engineer'], 2: ['Support Agent', 'Senior Agent', 'Team Lead', 'QA Specialist'], 3: ['Account Executive', 'SDR', 'Sales Manager'], 4: ['Content Writer', 'Designer', 'Growth Marketer'], 5: ['Accountant', 'Financial Analyst'], 6: ['Recruiter', 'HR Generalist'] };
      const emps = []; let id = 1;
      for (const d of depts) {
        const head = id; emps.push([id++, pick(FIRST), pick(LAST), null, d[0], null, 'Head of ' + d[1], int(140, 210) * 1000, dateOnly(Date.UTC(int(2015, 2019), int(0, 11), int(1, 28))), 1]);
        const n = { 1: 9, 2: 10, 3: 6, 4: 5, 5: 4, 6: 3 }[d[0]];
        for (let k = 0; k < n; k++) emps.push([id++, pick(FIRST), pick(LAST), null, d[0], head, pick(titles[d[0]]), int(38, 125) * 1000, dateOnly(Date.UTC(int(2018, 2026), int(0, 11), int(1, 28))), rnd() < 0.92 ? 1 : 0]);
      }
      emps.forEach(e => { e[3] = (e[1] + '.' + e[2] + e[0]).toLowerCase() + '@example.com'; if (e[8] > '2026-10-31') e[8] = '2026-0' + int(1, 9) + '-1' + int(0, 9); });
      run('INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?,?)', emps);
      const projs = [[1, 'Helpdesk Migration', 2, '2026-01-15', '2026-06-30', 180000], [2, 'Mobile App v3', 1, '2025-10-01', null, 420000], [3, 'Q4 Campaign', 4, '2026-09-01', '2026-12-31', 95000], [4, 'ERP Rollout', 5, '2025-06-01', '2026-03-31', 250000], [5, 'AI Triage Bot', 1, '2026-04-01', null, 310000], [6, 'APAC Expansion', 3, '2026-02-01', null, 500000], [7, 'Onboarding Revamp', 6, '2026-05-10', '2026-08-30', 60000], [8, 'QA Scorecards', 2, '2026-07-01', null, 45000]];
      run('INSERT INTO projects VALUES (?,?,?,?,?,?)', projs);
      const ep = new Map();
      for (let k = 0; k < 60; k++) { const e = int(1, emps.length), p = pick(projs); const key = e + '-' + p[0]; if (!ep.has(key)) ep.set(key, [e, p[0], pick(['Lead', 'Contributor', 'Contributor', 'Reviewer']), int(10, 400)]); }
      run('INSERT INTO employee_projects VALUES (?,?,?,?)', [...ep.values()]);
    }

    if (which === 'shop' || which === 'all') {
      db.run(`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT, city TEXT, country TEXT, segment TEXT, signup_date DATE);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT, price REAL, cost REAL, stock INTEGER);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), order_date DATETIME, status TEXT, channel TEXT, total REAL);
CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), quantity INTEGER, unit_price REAL);`);
      const cities = [['Manila', 'Philippines'], ['Cebu', 'Philippines'], ['Davao', 'Philippines'], ['Singapore', 'Singapore'], ['Shanghai', 'China'], ['Austin', 'United States'], ['Denver', 'United States'], ['Sydney', 'Australia'], ['London', 'United Kingdom'], ['Toronto', 'Canada']];
      const custs = [];
      for (let i = 1; i <= 60; i++) { const f = pick(FIRST), l = pick(LAST), c = pick(cities); custs.push([i, f + ' ' + l, (f + '.' + l + i).toLowerCase() + '@mail.test', c[0], c[1], pick(['Consumer', 'Consumer', 'SMB', 'Enterprise']), dateOnly(Date.UTC(2025, 0, 1) + int(0, 640) * 864e5)]); }
      run('INSERT INTO customers VALUES (?,?,?,?,?,?,?)', custs);
      const prods = [['Noise-Cancel Headset', 'Audio', 129], ['USB-C Dock', 'Accessories', 89], ['Ergo Keyboard', 'Peripherals', 74], ['Vertical Mouse', 'Peripherals', 39], ['27" Monitor', 'Displays', 249], ['Webcam 4K', 'Video', 119], ['Laptop Stand', 'Accessories', 35], ['Desk Mat', 'Accessories', 19], ['Ring Light', 'Video', 45], ['Bluetooth Speaker', 'Audio', 59], ['Mechanical Keyboard', 'Peripherals', 139], ['34" Ultrawide', 'Displays', 449], ['Wireless Earbuds', 'Audio', 99], ['Cable Kit', 'Accessories', 15], ['Standing Desk', 'Furniture', 399], ['Task Chair', 'Furniture', 289], ['Footrest', 'Furniture', 29], ['Mic Arm', 'Audio', 49], ['Portable SSD 1TB', 'Storage', 109], ['NAS 2-Bay', 'Storage', 329]];
      run('INSERT INTO products VALUES (?,?,?,?,?,?)', prods.map((p, i) => [i + 1, p[0], p[1], p[2], Math.round(p[2] * (0.45 + rnd() * 0.2) * 100) / 100, int(0, 300)]));
      const orders = [], items = []; let itemId = 1;
      for (let i = 1; i <= 320; i++) {
        const t = Date.UTC(2025, 10, 1) + int(0, 380) * 864e5 + int(7, 22) * 36e5 + int(0, 59) * 6e4;
        const n = int(1, 4); let total = 0;
        for (let k = 0; k < n; k++) { const p = int(1, prods.length); const q = int(1, 3); const price = prods[p - 1][2]; total += q * price; items.push([itemId++, i, p, q, price]); }
        orders.push([i, int(1, 60), fmt(t, true), pick(['delivered', 'delivered', 'delivered', 'shipped', 'processing', 'cancelled', 'refunded']), pick(['web', 'web', 'mobile', 'marketplace']), Math.round(total * 100) / 100]);
      }
      run('INSERT INTO orders VALUES (?,?,?,?,?,?)', orders);
      run('INSERT INTO order_items VALUES (?,?,?,?,?)', items);
    }

    if (which === 'support' || which === 'all') {
      db.run(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT, team TEXT, shift TEXT, site TEXT, hire_date DATE);
CREATE TABLE tickets (id INTEGER PRIMARY KEY, customer_email TEXT, channel TEXT, priority TEXT, category TEXT, status TEXT, agent_id INTEGER REFERENCES agents(id), created_at DATETIME, first_response_at DATETIME, resolved_at DATETIME, csat INTEGER, meta TEXT);`);
      const agents = [];
      for (let i = 1; i <= 14; i++) agents.push([i, pick(FIRST) + ' ' + pick(LAST), pick(['Tier 1', 'Tier 1', 'Tier 2', 'Billing', 'Tech']), pick(['APAC', 'EMEA', 'AMER']), pick(['Manila', 'Cebu', 'Bogota']), dateOnly(Date.UTC(2022, 0, 1) + int(0, 1500) * 864e5)]);
      run('INSERT INTO agents VALUES (?,?,?,?,?,?)', agents);
      const tix = [];
      for (let i = 1; i <= 500; i++) {
        const created = Date.UTC(2026, 7, 1) + int(0, 91) * 864e5 + int(0, 23) * 36e5 + int(0, 59) * 6e4;
        const pr = pick(['low', 'normal', 'normal', 'normal', 'high', 'urgent']);
        const status = pick(['solved', 'solved', 'solved', 'solved', 'closed', 'open', 'pending']);
        const fr = created + int(2, pr === 'urgent' ? 45 : 600) * 6e4;
        const res = status === 'solved' || status === 'closed' ? fr + int(10, 4000) * 6e4 : null;
        const tags = [pick(['billing', 'login', 'shipping', 'refund', 'bug', 'how-to', 'account'])]; if (rnd() < 0.3) tags.push('vip');
        tix.push([i, 'cust' + int(1, 220) + '@mail.test', pick(['email', 'chat', 'chat', 'phone', 'social']), pr, tags[0], status, rnd() < 0.05 ? null : int(1, 14), fmt(created, true), fmt(fr, true), res ? fmt(res, true) : null, res && rnd() < 0.7 ? pick([1, 2, 3, 4, 4, 5, 5, 5]) : null, JSON.stringify({ browser: pick(['Chrome', 'Safari', 'Firefox', 'Edge', null]), lang: pick(['en', 'en', 'es', 'tl', 'zh']), tags })]);
      }
      run('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', tix);
    }
  }

  const api = { DIALECTS, splitRaw, translateStatement, registerFunctions, seed, mask, setDialect: (d) => { CURRENT = d; }, md5 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SQLPG = api;
})(typeof window !== 'undefined' ? window : globalThis);
