CREATE TABLE "CustomMergeField" (
  "key" TEXT PRIMARY KEY,
  "label" TEXT NOT NULL,
  "defaultValue" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomMergeField_key_format" CHECK ("key" ~ '^custom_[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "CustomMergeField_label_length" CHECK (length("label") BETWEEN 1 AND 100),
  CONSTRAINT "CustomMergeField_value_length" CHECK (length("defaultValue") <= 2000)
);
