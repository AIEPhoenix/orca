import { describe, expect, it } from 'vitest'
import { plainClassName, reportUnstyledScrollbars } from './check-styled-scrollbars.mjs'

describe('check-styled-scrollbars', () => {
  it('reports renderer vertical scroll containers without an Orca scrollbar style', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      'export function Example() { return <div className="max-h-64 overflow-y-auto p-1" /> }'
    )

    expect(reports).toHaveLength(1)
    expect(reports[0].text).toContain('overflow-y-auto')
  })

  it('accepts styled vertical scroll containers', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      'export function Example() { return <div className="max-h-64 overflow-auto scrollbar-sleek" /> }'
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts static cn composition when a sibling argument adds the scrollbar style', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn('max-h-64 overflow-y-auto', 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('reports unstyled cn composition once at the className attribute', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn('max-h-64 overflow-y-auto', 'p-1')} /> }"
    )

    expect(reports).toHaveLength(1)
    expect(reports[0].text).toContain('overflow-y-auto')
  })

  it('does not let conditional scrollbar classes satisfy unconditional vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn('overflow-y-auto', enabled && 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('does not let disabled object keys satisfy vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn('overflow-y-auto', { 'scrollbar-sleek': false })} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('reports computed object keys that add unstyled vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn({ ['overflow-y-auto']: true })} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts computed object keys that add styled vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={cn({ ['overflow-y-auto']: true, ['scrollbar-sleek']: true })} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('reports conditional computed object keys that can add unstyled vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={cn({ [enabled ? 'overflow-y-auto' : '']: true })} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts correlated object keys that toggle overflow and scrollbar together', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ open }) { return <div className={cn({ 'overflow-y-auto': open, 'scrollbar-sleek': open })} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts correlated boolean expressions that toggle overflow and scrollbar together', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ open }) { return <div className={cn(open && 'overflow-y-auto', open && 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('reports conditional branches that can render vertical overflow without a scrollbar style', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ ok }) { return <div className={ok ? 'overflow-y-auto' : 'scrollbar-sleek'} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts conditional branches when every vertical overflow branch is styled', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ ok }) { return <div className={ok ? 'overflow-y-auto scrollbar-sleek' : 'scrollbar-editor'} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('handles large conditional class objects without state expansion', () => {
    const conditionalClasses = Array.from(
      { length: 40 },
      (_, index) => `'px-${index}': flag${index}`
    ).join(', ')
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      `export function Example(props) { return <div className={cn({ 'overflow-y-auto': open, 'scrollbar-sleek': open, ${conditionalClasses} })} /> }`
    )

    expect(reports).toHaveLength(0)
  })

  it('reports vertical overflow inside array method chains', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={['p-2', enabled && 'overflow-y-auto'].filter(Boolean).join(' ')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts styled vertical overflow inside array method chains', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={['p-2', enabled && 'overflow-y-auto scrollbar-sleek'].filter(Boolean).join(' ')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('does not let arbitrary filter predicates prove a separate scrollbar class survives', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={['overflow-y-auto', 'scrollbar-sleek'].filter((c) => c !== 'scrollbar-sleek').join(' ')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('does not let slice prove a separate scrollbar class survives', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={['scrollbar-sleek'].slice(1).concat('overflow-y-auto').join(' ')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts arbitrary filter predicates when overflow and scrollbar are in the same array term', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={['overflow-y-auto scrollbar-sleek'].filter((c) => c.length > 0).join(' ')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('does not let logical fallback scrollbar classes satisfy the true branch', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={cn(enabled && 'overflow-y-auto' || 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('does not treat arbitrary boolean call arguments as emitted class names', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ classes }) { return <div className={cn('overflow-y-auto', classes.includes('scrollbar-sleek'))} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('does not inspect arbitrary boolean call receivers as emitted class names', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ mode }) { return <div className={cn(['overflow-y-auto'].includes(mode))} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('reports class-like helper calls that receive unstyled vertical overflow classes', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={makeClasses('overflow-y-auto')} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('reports variant helper className values that contain unstyled vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={buttonVariants({ className: 'overflow-y-auto' })} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts variant helper className values that include a scrollbar style', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example() { return <div className={buttonVariants({ className: 'overflow-y-auto scrollbar-sleek' })} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts styled vertical overflow in a logical fallback branch', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={cn(enabled || 'overflow-y-auto scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts exhaustive conditional scrollbar style selection', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ editor }) { return <div className={cn('overflow-y-auto', editor ? 'scrollbar-editor' : 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts exhaustive scrollbar style selection with compound conditions', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ open, editor }) { return <div className={cn('overflow-y-auto', open && editor ? 'scrollbar-editor' : 'scrollbar-sleek')} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts exhaustive conditional scrollbar object keys', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ editor }) { return <div className={cn('overflow-y-auto', { 'scrollbar-editor': editor, 'scrollbar-sleek': !editor })} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('accepts exhaustive scrollbar object keys with negated compound conditions', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ open, editor }) { return <div className={cn('overflow-y-auto', { 'scrollbar-editor': open && editor, 'scrollbar-sleek': !(open && editor) })} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('reports template interpolation branches that can render unstyled vertical overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={`${enabled ? 'overflow-y-auto' : ''} p-2`} /> }"
    )

    expect(reports).toHaveLength(1)
  })

  it('accepts template interpolation branches when every vertical overflow branch is styled', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      "export function Example({ enabled }) { return <div className={`p-2 ${enabled ? 'overflow-y-auto scrollbar-sleek' : ''}`} /> }"
    )

    expect(reports).toHaveLength(0)
  })

  it('does not require a vertical scrollbar style for horizontal-only overflow', () => {
    const reports = reportUnstyledScrollbars(
      'Example.tsx',
      'export function Example() { return <pre className="max-w-full overflow-x-auto" /> }'
    )

    expect(reports).toHaveLength(0)
  })

  it('normalizes Tailwind variants and important prefixes before matching', () => {
    expect(plainClassName('md:overflow-y-auto')).toBe('overflow-y-auto')
    expect(plainClassName('!scrollbar-editor')).toBe('scrollbar-editor')
  })
})
