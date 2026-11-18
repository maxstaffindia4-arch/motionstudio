import { z } from 'zod';
import {
  ANIMATION_PRESETS,
  ANCHORS,
  BackgroundSchema,
  ElementSchema,
  SceneSpecSchema,
} from '@motion-studio/engine';

/**
 * Generate a compact scene-spec grammar doc FROM the engine zod schemas —
 * never hand-copied, so prompt docs can't drift from the real contract.
 */

type Def = Record<string, any>;

function typeName(s: z.ZodTypeAny): string {
  return (s._def as Def).typeName as string;
}

function unwrap(s: z.ZodTypeAny): z.ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 6; i++) {
    const tn = typeName(cur);
    if (tn === 'ZodDefault' || tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodEffects' || tn === 'ZodReadonly') {
      cur = (cur._def as Def).innerType ?? (cur._def as Def).schema;
      continue;
    }
    if (tn === 'ZodLazy') {
      cur = (cur._def as Def).getter();
      continue;
    }
    return cur;
  }
  return cur;
}

function isOptional(s: z.ZodTypeAny): boolean {
  return ['ZodOptional', 'ZodDefault', 'ZodNullable'].includes(typeName(s));
}

function shapeOf(s: z.ZodTypeAny): Record<string, z.ZodTypeAny> | undefined {
  const u = unwrap(s);
  if (typeName(u) === 'ZodObject') {
    const sh = (u._def as Def).shape;
    return typeof sh === 'function' ? sh() : sh;
  }
  return undefined;
}

/** One-line type summary for a schema node. */
function summarize(s: z.ZodTypeAny, depth = 0): string {
  const u = unwrap(s);
  const tn = typeName(u);
  const d = u._def as Def;
  switch (tn) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodLiteral': return JSON.stringify(d.value);
    case 'ZodEnum': return (d.values as string[]).map((v) => `'${v}'`).join('|');
    case 'ZodNativeEnum': return 'enum';
    case 'ZodArray': return `${summarize(d.type, depth + 1)}[]`;
    case 'ZodRecord': return 'Record<string, any>';
    case 'ZodTuple': return `[${(d.items as z.ZodTypeAny[]).map((i) => summarize(i, depth + 1)).join(', ')}]`;
    case 'ZodUnion': return (d.options as z.ZodTypeAny[]).map((o) => summarize(o, depth + 1)).join(' | ');
    case 'ZodDiscriminatedUnion': {
      const opts = Array.isArray(d.options) ? d.options : Object.values(d.options as Record<string, z.ZodTypeAny>);
      const tags = opts.map((o) => {
        const sh = shapeOf(o);
        const disc = sh?.[(d.discriminator as string)] ?? Object.values(sh ?? {})[0];
        return disc ? summarize(disc, depth + 1) : '?';
      });
      return tags.join(' | ');
    }
    case 'ZodObject': {
      const sh = shapeOf(u);
      if (!sh) return 'object';
      const keys = Object.keys(sh);
      if (depth > 2 || keys.length > 14) return `{ ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''} }`;
      return `{ ${keys.map((k) => `${k}${isOptional(sh[k]!) ? '?' : ''}: ${summarize(sh[k]!, depth + 1)}`).join('; ')} }`;
    }
    default: return tn.replace(/^Zod/, '').toLowerCase();
  }
}

function discriminatedOptions(s: z.ZodTypeAny): z.ZodTypeAny[] | undefined {
  const u = unwrap(s);
  if (typeName(u) !== 'ZodDiscriminatedUnion') return undefined;
  const d = u._def as Def;
  const opts = Array.isArray(d.options) ? d.options : Object.values(d.options as Record<string, z.ZodTypeAny>);
  return opts as z.ZodTypeAny[];
}

function discTag(s: z.ZodTypeAny, discKey: string): string {
  const sh = shapeOf(s);
  const f = sh?.[discKey];
  return f ? summarize(f) : '?';
}

function describeObject(s: z.ZodTypeAny, indent: string, depth: number): string[] {
  if (depth > 6) return [`${indent}- <recursive — see variants above>`];
  const topOpts = discriminatedOptions(s);
  if (topOpts) {
    const discKey = ((unwrap(s)._def as Def).discriminator as string) ?? 'type';
    const lines: string[] = [];
    for (const o of topOpts) {
      lines.push(`${indent}- variant ${discTag(o, discKey)}:`);
      lines.push(...describeObject(o, `${indent}  `, depth + 1));
    }
    return lines;
  }
  const sh = shapeOf(s);
  if (!sh) return [`${indent}- ${summarize(s)}`];
  const lines: string[] = [];
  for (const [key, val] of Object.entries(sh)) {
    const u = unwrap(val);
    const tn = typeName(u);
    const reqMark = isOptional(val) ? '?' : '';
    if (tn === 'ZodObject' || tn === 'ZodDiscriminatedUnion') {
      lines.push(`${indent}- ${key}${reqMark}:`);
      if (tn === 'ZodDiscriminatedUnion') {
        const opts = Array.isArray((u._def as Def).options)
          ? ((u._def as Def).options as z.ZodTypeAny[])
          : Object.values((u._def as Def).options as Record<string, z.ZodTypeAny>);
        for (const o of opts) {
          const osh = shapeOf(o);
          const discKey = (u._def as Def).discriminator as string;
          const discVal = osh?.[discKey] ? summarize(osh[discKey]!) : '?';
          lines.push(`${indent}  - when ${discKey}=${discVal}:`);
          lines.push(...describeObject(o, `${indent}    `, depth + 1));
        }
      } else {
        lines.push(...describeObject(u, `${indent}  `, depth + 1));
      }
    } else if (tn === 'ZodArray' && typeName(unwrap((u._def as Def).type)) === 'ZodDiscriminatedUnion') {
      lines.push(`${indent}- ${key}${reqMark}: array of:`);
      const inner = unwrap((u._def as Def).type);
      const opts = Array.isArray((inner._def as Def).options)
        ? ((inner._def as Def).options as z.ZodTypeAny[])
        : Object.values((inner._def as Def).options as Record<string, z.ZodTypeAny>);
      for (const o of opts) {
        const osh = shapeOf(o);
        const discKey = (inner._def as Def).discriminator as string;
        const discVal = osh?.[discKey] ? summarize(osh[discKey]!) : '?';
        lines.push(`${indent}  - ${discVal}:`);
        lines.push(...describeObject(o, `${indent}    `, depth + 1));
      }
    } else {
      lines.push(`${indent}- ${key}${reqMark}: ${summarize(val)}`);
    }
  }
  return lines;
}

/** Full scene-spec grammar doc, generated from the live zod schemas. */
export function sceneSpecDoc(): string {
  const lines: string[] = [];
  lines.push('## SCENE SPEC (JSON you must return — one of two shapes)');
  lines.push('');
  lines.push('Shape A — known component (preferred when one fits):');
  lines.push('  { "component": "<component-id>", "params": { ...component params... }, "tokens"?, "theme"?, "background"? }');
  lines.push('Shape B — custom scene:');
  lines.push('  { "specVersion": 1, "canvas": {...}, "tokens"?, "theme"?, "background": {...}, "elements": [ ... ] }');
  lines.push('');
  lines.push('### SceneSpec fields');
  lines.push(...describeObject(SceneSpecSchema, '  ', 0));
  lines.push('');
  lines.push('### Element types (elements[] items, discriminated by "type")');
  lines.push(...describeObject(ElementSchema, '  ', 0));
  lines.push('');
  lines.push('### Background kinds (background field)');
  lines.push(...describeObject(BackgroundSchema, '  ', 0));
  lines.push('');
  lines.push(`### Animation presets: ${ANIMATION_PRESETS.map((p) => `'${p}'`).join(', ')}`);
  lines.push(`### Placement anchors: ${ANCHORS.map((a) => `'${a}'`).join(', ')}  — or { "flow": true } inside a stack`);
  lines.push('### Units: all px values are at unit=1 (min(canvas.w,canvas.h)/1080). Stack gap minimum = 24 spec units. start/duration in seconds.');
  return lines.join('\n');
}
