import { COMPONENTS } from '@motion-studio/engine';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ComponentDef } from '@motion-studio/engine';

export interface ComponentCatalogEntry {
  id: string;
  name: string;
  description: string;
  example: string;
  paramFields: ComponentDef['paramFields'];
  /** JSON-schema of the component's paramsSchema (for the model). */
  paramsSchema: unknown;
}

let cache: ComponentCatalogEntry[] | undefined;

/** Catalog built from the live engine registry — never hand-maintained. */
export function componentCatalog(): ComponentCatalogEntry[] {
  if (cache) return cache;
  cache = Object.values(COMPONENTS).map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    example: def.example,
    paramFields: def.paramFields,
    paramsSchema: zodToJsonSchema(def.paramsSchema as never, { $refStrategy: 'none' }),
  }));
  return cache;
}

/** Compact catalog text for the system prompt. */
export function catalogText(): string {
  const lines: string[] = ['## COMPONENT CATALOG (shape A targets)'];
  for (const c of componentCatalog()) {
    lines.push(`### ${c.id} — ${c.name}`);
    lines.push(c.description);
    lines.push(`params JSON schema: ${JSON.stringify(c.paramsSchema)}`);
    lines.push(`example params: ${c.example}`);
    lines.push('');
  }
  return lines.join('\n');
}
