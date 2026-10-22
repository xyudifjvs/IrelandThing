-- Normalize the original synthetic preview vocabulary to the canonical workflow states.
UPDATE "Task" SET "status"='pending' WHERE "status"='needed';
UPDATE "Task" SET "status"='completed' WHERE "status"='complete';
UPDATE "Matter" SET "stage"='listing' WHERE "stage"='pre_listing';
UPDATE "Matter" SET "stage"='under_contract' WHERE "stage"='active';
