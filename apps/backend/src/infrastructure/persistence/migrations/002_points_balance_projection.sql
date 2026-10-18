CREATE TABLE point_balances (
  user_id text PRIMARY KEY,
  balance bigint NOT NULL
);

INSERT INTO point_balances (user_id, balance)
SELECT user_id, SUM(points)
FROM point_events
GROUP BY user_id;
