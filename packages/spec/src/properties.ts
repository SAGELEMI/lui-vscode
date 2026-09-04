import { parse } from 'luaparse';
import { canonicalAttribute } from './vocabulary.js';
export interface ComponentProperty {
  type: 'string' | 'number' | 'boolean' | 'table' | 'event';
  default?: unknown;
  description?: string;
  start?: number;
}
export type ComponentProperties = Record<string, ComponentProperty>;
export const LAYOUT_PROPERTIES = new Set(['x:Name','x:DisplayName','x:Ref','Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight','Margin','Padding','HorizontalAlignment','VerticalAlignment','Visibility','ZIndex','ClipToBounds','RenderTransform','LayoutTransform','RenderTransformOrigin','ChildLayout','Wrap','Fill','ChildWidth','ChildHeight','HorizontalGap','VerticalGap']);
export function isLayoutProperty(name: string): boolean { return LAYOUT_PROPERTIES.has(canonicalAttribute(name)); }
export function validPropertyName(name: string): boolean { return !!name && !/[\s<>/="':\[\]\\]/u.test(name) && !/^\d/u.test(name) && !['__proto__','constructor','prototype'].includes(name); }
export function propertyTypeMatches(value: unknown, type: ComponentProperty['type']): boolean {
  return type === 'table' ? !!value && typeof value === 'object' : type === 'event' ? typeof value === 'string' : typeof value === type;
}
/** Inspect a literal assignment on the returned class, never execute its backend. */
export function readComponentProperties(source: string): { properties?: ComponentProperties; error?: string } {
  try {
    const ast = parse(source, { luaVersion: '5.3', ranges: true });
    const returned = [...ast.body].reverse().find((n: any) => n.type === 'ReturnStatement')?.arguments?.[0];
    const className = returned?.type === 'Identifier' ? returned.name : undefined;
    const matches = ast.body.filter((n: any) => n.type === 'AssignmentStatement' && n.variables?.some((v: any) => v.type === 'MemberExpression' && v.base.name === className && v.identifier.name === 'Properties'));
    if (!matches.length) return {};
    if (matches.length !== 1) throw Error('Properties 只能声明一次');
    const literal = (node: any): any => {
      if (!node) throw Error('缺少字面量');
      if (node.type === 'StringLiteral') {
        const raw = node.raw as string;
        if (raw[0] !== '"' && raw[0] !== "'") throw Error('请使用单引号或双引号字符串');
        if (/\\[^\\"'nrt]/.test(raw.slice(1, -1))) throw Error('声明字符串包含不支持的转义');
        return raw.slice(1, -1).replace(/\\([\\"'nrt])/g, (_: string, c: string) => (({ n:'\n',r:'\r',t:'\t' } as Record<string,string>)[c] ?? c));
      }
      if (['NumericLiteral','BooleanLiteral'].includes(node.type)) return node.value;
      if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') return -node.argument.value;
      if (node.type === 'TableConstructorExpression') {
        const result: Record<string, unknown> = Object.create(null); let index = 1;
        for (const field of node.fields) {
          const key = field.type === 'TableKeyString' ? field.key.name : field.type === 'TableKey' ? literal(field.key) : String(index++);
          if (Object.hasOwn(result, key)) throw Error(`重复键：${key}`);
          result[key] = literal(field.value);
        }
        return result;
      }
      throw Error('Properties 仅允许字面量表，不能调用函数或使用计算表达式');
    };
    const statement = matches[0]; const index = statement.variables.findIndex((v: any) => v.identifier?.name === 'Properties');
    const properties = literal(statement.init[index]) as ComponentProperties;
    if (statement.init[index].type !== 'TableConstructorExpression') throw Error('Properties 必须是字面量表');
    for (const [name, definition] of Object.entries(properties)) {
      if (!validPropertyName(name) || isLayoutProperty(name)) throw Error(`属性名非法或覆盖公共布局属性：${name}`);
      if (!definition || !['string','number','boolean','table','event'].includes(definition.type)) throw Error(`属性类型无效：${name}`);
      if (definition.description !== undefined && typeof definition.description !== 'string') throw Error(`属性说明必须是字符串：${name}`);
      if (definition.default !== undefined && (definition.type === 'event' || !propertyTypeMatches(definition.default, definition.type))) throw Error(`默认值类型不符：${name}`);
      const field = statement.init[index].fields.find((f: any) => (f.type === 'TableKeyString' ? f.key.name : literal(f.key)) === name);
      definition.start = field.range[0];
    }
    return { properties };
  } catch (error) { return { error: `公开属性声明错误：${(error as Error).message}` }; }
}
