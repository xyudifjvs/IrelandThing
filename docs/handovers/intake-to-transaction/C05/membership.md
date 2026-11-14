# Intake membership

The intake page reads the current signed-in actor's business from `GET /api/v1/intake/membership`. The existing reference and legacy draft forms show buyer or seller representation without the paid service step for Home Team Ohio. Gift questions and the current draft save, resume and upload controls remain available.

Submission resolves membership again through C08's `getAgentMembership` in the database transaction. The submitted browser fields cannot set business or opt into the included package. New Home Team Ohio receipts and their pending Matters use `hto` and `hto_included`, carry the linked roster ID when present, and omit paid service terms. The saved gift answers remain in the immutable snapshot. Existing receipts replay with the same ID and snapshot even if membership has since changed.

C00 and C13 can use the new receipt business and `hto_included` package for overview and portal labels. C09 owns service and gift payment behavior. C00 owns provider job registration, and account setup stays on Ireland's laptop.
