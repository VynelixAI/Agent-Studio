/**
 * Re-export the Studio item handover contract (n8n items + Flowise json/text).
 * Canonical source: server/src/codegen/itemHandoverContract.ts
 */
export {
  BIND_ID_KEYS,
  FAMILY_BIND_ALIASES,
  ITEM_LIST_KEYS,
  META_SKIP_KEYS,
  NESTED_ENVELOPE_KEYS,
  NESTED_UNWRAP_KEYS,
  PAYLOAD_SHAPE_KEYS,
  emitHandoverConstantsPy,
  pyStringSet,
  pyStringTuple,
  type BindIdKey,
} from "../../server/src/codegen/itemHandoverContract.ts";
