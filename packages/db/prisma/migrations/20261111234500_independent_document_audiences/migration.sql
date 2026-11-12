-- A legacy file can override one audience while the other retains its prior grant.
ALTER TABLE "Document" DROP CONSTRAINT "Document_share_flags_pair_check";
