DROP INDEX "expense_external_refs_external";--> statement-breakpoint
DROP INDEX "settlement_external_refs_external";--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_external_refs_settlement" ON "settlement_external_refs" USING btree ("settlement_id","provider");--> statement-breakpoint
CREATE INDEX "expense_external_refs_external" ON "expense_external_refs" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "settlement_external_refs_external" ON "settlement_external_refs" USING btree ("provider","external_id");