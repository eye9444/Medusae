// Keep provider grammar small. Full bounds, UUIDs and citations are checked locally.
export function providerSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const result = {};
  for (const key of ['type', 'enum', 'required', 'additionalProperties']) {
    if (schema[key] !== undefined) result[key] = schema[key];
  }
  if (schema.properties) result.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, value]) => [name, providerSchema(value)])
  );
  if (schema.items) result.items = providerSchema(schema.items);
  return result;
}
