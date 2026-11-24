ALTER TABLE repair_order ADD COLUMN estimated_completion_at TIMESTAMP;
--> statement-breakpoint
ALTER TABLE repair_order ADD COLUMN severity TEXT CHECK (severity IN ('低','中','高'));
--> statement-breakpoint
UPDATE repair_order AS r SET severity=(
  SELECT substr(u.note,length('严重程度：')+1,1) FROM repair_update u
  WHERE u.repair_order_id=r.repair_order_id AND substr(u.note,1,length('严重程度：')+2) IN
    ('严重程度：低；','严重程度：中；','严重程度：高；')
  ORDER BY u.repair_update_id LIMIT 1
);
