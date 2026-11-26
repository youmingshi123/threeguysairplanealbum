CREATE TABLE users (
  username TEXT PRIMARY KEY NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE aircrafts (
  id TEXT PRIMARY KEY NOT NULL,
  model TEXT NOT NULL,
  reg TEXT NOT NULL COLLATE NOCASE UNIQUE,
  airline TEXT NOT NULL,
  livery TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]' CHECK (json_type(photos) = 'array')
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE,
  expires INTEGER NOT NULL
);

CREATE TABLE gallery (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL
);
INSERT INTO gallery VALUES (1, lower(hex(randomblob(16))));

-- 改名和改密与照片署名、会话撤销在同一事务内完成。
CREATE TRIGGER account_changed AFTER UPDATE ON users BEGIN
  UPDATE aircrafts SET photos = (
    SELECT json_group_array(json(CASE WHEN value ->> '$.uploader' = OLD.username
      THEN json_set(value, '$.uploader', NEW.username) ELSE value END))
    FROM json_each(aircrafts.photos)
  ) WHERE OLD.username <> NEW.username AND EXISTS (
    SELECT 1 FROM json_each(aircrafts.photos) WHERE value ->> '$.uploader' = OLD.username
  );
  DELETE FROM sessions WHERE username IN (OLD.username, NEW.username);
  UPDATE gallery SET version = lower(hex(randomblob(16))) WHERE id = 1;
END;

-- 初始密码均为 11111111。存储格式为盐值.派生值（十六进制）。
INSERT INTO users (username, password) VALUES
  ('user1', '782dbeef7e43e986455e22796947d1fb.6eedd9c8b6c5a8204e185ba6340811140b50e112de78873dbcc7cb08d541a8c5'),
  ('user2', '72f97ecb5b3dce263cc97eca5321dec9.63fd69be57f8ea7fd23cb328b966b2f4ee95e54e610d82cc0969d148c1e3cdcd'),
  ('user3', 'd24dfe3765bd7104538cc9070699da0b.49f7d684543be65156c4a7b2f80dea485989fc8b159f2d709700d993167fc7b6'),
  ('beiyong', '3d7044a9d3ec926ca6bb298ff6d3e5be.cd744e135440b77e4020b4bc92d4e0f8e3cc3fd01998b8cf49ac18fdeff4304b');
