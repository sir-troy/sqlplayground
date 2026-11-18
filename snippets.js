/* Example queries per dialect (all run against the sample data) */
(function (root) {
  const SNIPPETS = {
    sqlite: [
      ['Top earners per department', `-- Window function: rank employees by salary inside each department
SELECT d.name AS department,
       e.first_name || ' ' || e.last_name AS employee,
       e.salary,
       RANK() OVER (PARTITION BY d.id ORDER BY e.salary DESC) AS rnk
FROM employees e
JOIN departments d ON d.id = e.department_id
WHERE e.is_active = 1
ORDER BY department, rnk
LIMIT 20;`],
      ['Monthly revenue (strftime)', `SELECT strftime('%Y-%m', order_date) AS month,
       COUNT(*)                     AS orders,
       ROUND(SUM(total), 2)         AS revenue
FROM orders
WHERE status NOT IN ('cancelled', 'refunded')
GROUP BY month
ORDER BY month;`],
      ['JSON: tickets by tag', `SELECT j.value AS tag, COUNT(*) AS tickets
FROM tickets, json_each(tickets.meta, '$.tags') AS j
GROUP BY tag
ORDER BY tickets DESC;`],
      ['Recursive CTE: org chart', `WITH RECURSIVE chain(id, name, manager_id, depth) AS (
  SELECT id, first_name || ' ' || last_name, manager_id, 0
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.first_name || ' ' || e.last_name, e.manager_id, c.depth + 1
  FROM employees e JOIN chain c ON e.manager_id = c.id
)
SELECT substr('            ', 1, depth * 4) || name AS org_chart
FROM chain
LIMIT 25;`],
      ['Create, insert, upsert', `CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  body TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO notes (slug, body) VALUES ('hello', 'first version')
  ON CONFLICT(slug) DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP;
INSERT INTO notes (slug, body) VALUES ('hello', 'second version')
  ON CONFLICT(slug) DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP;
SELECT * FROM notes;`],
    ],
    mysql: [
      ['DATE_FORMAT + IF + GROUP_CONCAT', `SELECT DATE_FORMAT(order_date, '%Y-%m')        AS month,
       COUNT(*)                                 AS orders,
       SUM(IF(status = 'cancelled', 1, 0))      AS cancelled,
       GROUP_CONCAT(DISTINCT channel)           AS channels
FROM orders
GROUP BY DATE_FORMAT(order_date, '%Y-%m')
ORDER BY month DESC
LIMIT 6;`],
      ['LIMIT offset, count', `SELECT \`id\`, \`name\`, \`price\`
FROM products
ORDER BY price DESC
LIMIT 5, 5;   -- rows 6-10`],
      ['DATE_ADD / DATEDIFF / TIMESTAMPDIFF', `SELECT id,
       created_at,
       DATE_ADD(created_at, INTERVAL 3 DAY)              AS sla_due,
       DATEDIFF(resolved_at, created_at)                 AS days_open,
       TIMESTAMPDIFF(MINUTE, created_at, first_response_at) AS frt_minutes
FROM tickets
WHERE resolved_at IS NOT NULL
ORDER BY frt_minutes DESC
LIMIT 10;`],
      ['CREATE TABLE (AUTO_INCREMENT, ENGINE)', `CREATE TABLE IF NOT EXISTS audit_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor VARCHAR(64) NOT NULL COMMENT 'who did it',
  action ENUM('create','update','delete') NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_actor (actor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO audit_log (actor, action) VALUES ("troy", 'create'), ('ana', 'update');
SELECT * FROM audit_log;`],
      ['SHOW / DESCRIBE', `SHOW TABLES;
DESCRIBE tickets;`],
    ],
    postgres: [
      ['DATE_TRUNC + :: casts', `SELECT date_trunc('week', created_at::timestamp)::date AS week,
       COUNT(*)                                          AS tickets,
       ROUND(AVG(csat)::numeric, 2)                      AS avg_csat
FROM tickets
GROUP BY 1
ORDER BY 1;`],
      ['STRING_AGG + ILIKE', `SELECT d.name,
       STRING_AGG(e.first_name, ', ') AS people
FROM departments d
JOIN employees e ON e.department_id = d.id
WHERE e.title ILIKE '%engineer%' OR e.title ILIKE '%agent%'
GROUP BY d.name;`],
      ['generate_series calendar', `SELECT g.generate_series AS day_of_month,
       COUNT(o.id) AS orders
FROM generate_series(1, 31) AS g
LEFT JOIN orders o ON EXTRACT(DAY FROM o.order_date) = g.generate_series
GROUP BY 1
ORDER BY 1;`],
      ['SERIAL + RETURNING', `CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO feedback (ticket_id, comment) VALUES (1, 'Quick fix, thanks!') RETURNING id, created_at;`],
      ['Interval math + EXTRACT', `SELECT id,
       created_at,
       created_at::timestamp + INTERVAL '2 hours' AS first_sla,
       EXTRACT(DOW FROM created_at)              AS dow,
       EXTRACT(HOUR FROM created_at)             AS hour
FROM tickets
LIMIT 10;`],
    ],
    mssql: [
      ['TOP + DATEDIFF', `SELECT TOP 10
       t.id,
       a.name AS agent,
       DATEDIFF(minute, t.created_at, t.first_response_at) AS frt_min,
       ISNULL(CAST(t.csat AS VARCHAR(5)), 'n/a') AS csat
FROM tickets t
LEFT JOIN agents a ON a.id = t.agent_id
ORDER BY frt_min DESC;`],
      ['OFFSET / FETCH paging', `SELECT [id], [name], [price]
FROM products
ORDER BY price DESC
OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY;`],
      ['DATEADD / DATEPART / string +', `SELECT id,
       DATEADD(day, 7, order_date)  AS follow_up,
       DATEPART(weekday, order_date) AS weekday,
       'Order #' + CAST(id AS VARCHAR(10)) AS label,
       LEN(status) AS status_len
FROM orders
WHERE YEAR(order_date) = 2026;`],
      ['IDENTITY table + GETDATE()', `CREATE TABLE shifts (
  id INT IDENTITY(1,1) PRIMARY KEY,
  agent_id INT NOT NULL,
  starts_at DATETIME2 DEFAULT GETDATE(),
  note NVARCHAR(MAX)
);
GO
INSERT INTO shifts (agent_id, note) VALUES (1, N'Night shift');
SELECT * FROM shifts;`],
    ],
    oracle: [
      ['NVL / DECODE / FROM DUAL', `SELECT SYSDATE AS now_ts,
       TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI') AS formatted,
       NVL(NULL, 'fallback') AS nvl_demo,
       DECODE(2, 1, 'one', 2, 'two', 'other') AS decode_demo
FROM DUAL;`],
      ['ROWNUM', `SELECT id, name, price
FROM products
WHERE category = 'Audio' AND ROWNUM <= 3;`],
      ['FETCH FIRST + TO_CHAR', `SELECT TO_CHAR(hire_date, 'Mon YYYY') AS hired,
       first_name || ' ' || last_name AS employee,
       salary
FROM employees
ORDER BY salary DESC
FETCH FIRST 5 ROWS ONLY;`],
      ['ADD_MONTHS / TRUNC / LAST_DAY', `SELECT id, order_date,
       TRUNC(order_date, 'MM') AS month_start,
       LAST_DAY(order_date)    AS month_end,
       ADD_MONTHS(order_date, 1) AS next_month
FROM orders
FETCH FIRST 8 ROWS ONLY;`],
    ],
    maxcompute: [
      ['Partitioned table + INSERT OVERWRITE', `SET odps.sql.type.system.odps2=true;

CREATE TABLE IF NOT EXISTS dws_ticket_daily (
  channel   STRING COMMENT 'support channel',
  tickets   BIGINT,
  avg_csat  DOUBLE
)
COMMENT 'daily ticket summary'
PARTITIONED BY (ds STRING)
LIFECYCLE 30;

INSERT OVERWRITE TABLE dws_ticket_daily PARTITION (ds = '20261001')
SELECT channel, COUNT(*), AVG(csat)
FROM tickets
WHERE TO_CHAR(created_at, 'yyyymmdd') = '20261001'
GROUP BY channel;

SELECT * FROM dws_ticket_daily WHERE ds = '20261001';`],
      ['DATEADD / DATEDIFF / DATETRUNC', `SELECT id,
       created_at,
       DATEADD(created_at, 1, 'dd')               AS next_day,
       DATEDIFF(resolved_at, created_at, 'hh')    AS hours_to_resolve,
       DATETRUNC(created_at, 'mm')                AS month_start,
       TO_CHAR(created_at, 'yyyy-mm-dd hh:mi:ss') AS formatted
FROM tickets
WHERE resolved_at IS NOT NULL
LIMIT 10;`],
      ['WM_CONCAT + GET_JSON_OBJECT', `SELECT GET_JSON_OBJECT(meta, '$.lang')     AS lang,
       COUNT(*)                             AS tickets,
       WM_CONCAT(',', DISTINCT priority)    AS priorities
FROM tickets
GROUP BY GET_JSON_OBJECT(meta, '$.lang');`],
      ['NVL / IF / CAST AS STRING', `SELECT id,
       NVL(csat, 0)                             AS csat,
       IF(priority IN ('high','urgent'), 'P1', 'P2') AS bucket,
       CONCAT('T-', CAST(id AS STRING))         AS ticket_key
FROM tickets
LIMIT 10;`],
    ],
    hive: [
      ['collect_set + date functions', `SELECT to_date(created_at)                      AS day,
       count(*)                                   AS tickets,
       collect_set(channel)                       AS channels,
       datediff(max(created_at), min(created_at)) AS span_days
FROM tickets
GROUP BY to_date(created_at)
ORDER BY day DESC
LIMIT 7;`],
      ['date_format / from_unixtime / regexp', `SELECT id,
       date_format(created_at, 'yyyy-MM-dd HH:mm') AS created,
       from_unixtime(unix_timestamp(created_at), 'EEE') AS dow,
       regexp_extract(customer_email, '^(\\\\w+)@', 1)  AS user_part
FROM tickets
LIMIT 10;`],
      ['INSERT OVERWRITE (dynamic partition)', `CREATE TABLE IF NOT EXISTS orders_by_day (
  order_id BIGINT,
  total    DOUBLE
)
PARTITIONED BY (dt STRING)
STORED AS ORC;

INSERT OVERWRITE TABLE orders_by_day PARTITION (dt)
SELECT id, total, substr(order_date, 1, 10) AS dt
FROM orders;

SELECT dt, count(*) AS orders, round(sum(total), 2) AS revenue
FROM orders_by_day
GROUP BY dt ORDER BY dt DESC LIMIT 5;`],
      ['percentile + stddev', `SELECT category,
       percentile(price, 0.5)  AS median_price,
       round(stddev(price), 2) AS sd_price,
       count(*)                AS n
FROM products
GROUP BY category;`],
    ],
  };

  const DIALECT_NOTES = {
    sqlite: 'Native SQLite 3.45 running in your browser (WebAssembly). Everything SQLite supports works here: CTEs, window functions, JSON1, UPSERT, RETURNING, triggers, views.',
    mysql: 'Emulated on SQLite. Translates backticks, double-quoted strings, LIMIT a,b, IF(), DATE_FORMAT, DATE_ADD/SUB + INTERVAL, DATEDIFF, TIMESTAMPDIFF, CONVERT, AUTO_INCREMENT/ENGINE/ENUM DDL, INSERT IGNORE, SHOW TABLES, DESCRIBE. Not supported: stored procedures, user @variables, ON DUPLICATE KEY UPDATE.',
    postgres: 'Emulated on SQLite. Translates ::casts, ILIKE, SERIAL/IDENTITY, DATE_TRUNC, EXTRACT, INTERVAL arithmetic, STRING_AGG, ARRAY_AGG (as JSON), generate_series, TO_CHAR, \\dt and \\d. Not supported: DISTINCT ON, arrays/JSONB operators beyond ->/->>, schemas, PL/pgSQL.',
    mssql: 'Emulated on SQLite. Translates [brackets], TOP n, OFFSET/FETCH, GO, N\'..\', IDENTITY, GETDATE, DATEADD/DATEDIFF/DATEPART, ISNULL, LEN, CHARINDEX, CONVERT, + string concat. Not supported: variables/DECLARE, T-SQL control flow, stored procedures, SELECT INTO.',
    oracle: 'Emulated on SQLite. Translates FROM DUAL, SYSDATE, NVL/NVL2, DECODE, ROWNUM <= n, FETCH FIRST, TO_CHAR/TO_DATE, ADD_MONTHS, TRUNC, LAST_DAY, LISTAGG. Not supported: PL/SQL, sequences, CONNECT BY.',
    maxcompute: 'Emulated on SQLite. Translates STRING/ARRAY/MAP types, PARTITIONED BY (as regular columns), LIFECYCLE, COMMENT, INSERT OVERWRITE … PARTITION, SET flags, DATEADD/DATEDIFF/DATETRUNC/DATEPART, TO_CHAR/TO_DATE, GETDATE, WM_CONCAT, GET_JSON_OBJECT, NVL, IF, KEYVALUE, REGEXP_*. Not supported: LATERAL VIEW, MAPJOIN hints, UDFs, tunnel/resources.',
    hive: 'Emulated on SQLite. Translates STRING/complex types, PARTITIONED BY, STORED AS, INSERT OVERWRITE/INTO TABLE … PARTITION, collect_list/collect_set (JSON arrays), date_format, from_unixtime, datediff, date_add, regexp_extract, percentile, RLIKE. Not supported: LATERAL VIEW explode, SerDes, bucketing.',
  };

  const api = { SNIPPETS, DIALECT_NOTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
