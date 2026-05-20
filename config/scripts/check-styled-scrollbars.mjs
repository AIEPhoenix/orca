import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import ts from 'typescript'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'])
const SKIP_PATH_PARTS = new Set(['node_modules', 'dist', 'out', '.git', '__snapshots__'])
const STYLED_SCROLLBAR_CLASSES = new Set([
  'scrollbar-sleek',
  'scrollbar-editor',
  'scrollbar-none',
  'worktree-sidebar-scrollbar'
])
// Why: vertical scrolling is where Orca's native scrollbar drift keeps showing
// up in cards, dialogs, and menus; horizontal code/table overflow is handled separately.
const VERTICAL_SCROLL_CLASSES = new Set([
  'overflow-auto',
  'overflow-scroll',
  'overflow-y-auto',
  'overflow-y-scroll'
])
const CLASS_COMPOSER_FUNCTIONS = new Set(['cn', 'clsx', 'classNames', 'classnames', 'twMerge'])
const CLASS_CHAIN_RECEIVER_METHODS = new Set(['flat', 'join'])
const CLASS_CHAIN_RECEIVER_AND_ARGUMENT_METHODS = new Set(['concat'])
const CLASS_CONFIG_PROPERTIES = new Set(['class', 'className', 'classes'])
const CLASS_HELPER_NAME_PATTERN = /(?:class|classes|variant|variants|cva|style|styles)/i

export function normalizePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function isSkippedFile(root, filePath) {
  const relative = normalizePath(root, filePath)
  if (relative.includes('.test.') || relative.includes('.spec.')) {
    return true
  }
  return relative.split('/').some((part) => SKIP_PATH_PARTS.has(part))
}

async function collectSourceFiles(root, dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_PATH_PARTS.has(entry.name)) {
        files.push(...(await collectSourceFiles(root, fullPath)))
      }
      continue
    }
    if (!entry.isFile() || isSkippedFile(root, fullPath)) {
      continue
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

export function plainClassName(token) {
  const withoutImportant = token.startsWith('!') ? token.slice(1) : token
  const variantSeparator = withoutImportant.lastIndexOf(':')
  return variantSeparator === -1 ? withoutImportant : withoutImportant.slice(variantSeparator + 1)
}

function hasVerticalScrollClass(text) {
  return text.split(/\s+/).some((token) => VERTICAL_SCROLL_CLASSES.has(plainClassName(token)))
}

function hasStyledScrollbarClass(text) {
  return text.split(/\s+/).some((token) => STYLED_SCROLLBAR_CLASSES.has(plainClassName(token)))
}

function lineAndColumnForPosition(sourceText, position) {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < position; index += 1) {
    if (sourceText.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: position - lineStart + 1 }
}

function stringFragments(node) {
  if (ts.isStringLiteralLike(node)) {
    return [node.text]
  }
  if (!ts.isTemplateExpression(node)) {
    return []
  }
  return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
}

function booleanLiteralValue(node) {
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false
  }
  return undefined
}

function normalizedExpression(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, '')
}

function inverseAtom(atom) {
  return atom.startsWith('!') ? atom.slice(1) : `!${atom}`
}

function atomName(atom) {
  return atom.startsWith('!') ? atom.slice(1) : atom
}

function atomValue(atom) {
  return !atom.startsWith('!')
}

function combineConditions(left, right) {
  if (!left || !right) {
    return undefined
  }

  const combined = [...left]
  for (const atom of right) {
    if (combined.includes(inverseAtom(atom))) {
      return undefined
    }
    if (!combined.includes(atom)) {
      combined.push(atom)
    }
  }
  return combined
}

function combineConditionBranches(leftBranches, rightBranches) {
  const combinedBranches = []
  for (const left of leftBranches) {
    for (const right of rightBranches) {
      const combined = combineConditions(left, right)
      if (combined) {
        combinedBranches.push(combined)
      }
    }
  }
  return combinedBranches
}

function conditionBranchesForTruthy(node, sourceFile) {
  const literalValue = booleanLiteralValue(node)
  if (literalValue === true) {
    return [[]]
  }
  if (literalValue === false) {
    return []
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return conditionBranchesForTruthy(node.expression, sourceFile)
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return conditionBranchesForFalsy(node.operand, sourceFile)
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return combineConditionBranches(
      conditionBranchesForTruthy(node.left, sourceFile),
      conditionBranchesForTruthy(node.right, sourceFile)
    )
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...conditionBranchesForTruthy(node.left, sourceFile),
      ...combineConditionBranches(
        conditionBranchesForFalsy(node.left, sourceFile),
        conditionBranchesForTruthy(node.right, sourceFile)
      )
    ]
  }

  return [[normalizedExpression(node, sourceFile)]]
}

function conditionBranchesForFalsy(node, sourceFile) {
  const literalValue = booleanLiteralValue(node)
  if (literalValue === true) {
    return []
  }
  if (literalValue === false) {
    return [[]]
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return conditionBranchesForFalsy(node.expression, sourceFile)
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return conditionBranchesForTruthy(node.operand, sourceFile)
  }

  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [
      ...conditionBranchesForFalsy(node.left, sourceFile),
      ...combineConditionBranches(
        conditionBranchesForTruthy(node.left, sourceFile),
        conditionBranchesForFalsy(node.right, sourceFile)
      )
    ]
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return combineConditionBranches(
      conditionBranchesForFalsy(node.left, sourceFile),
      conditionBranchesForFalsy(node.right, sourceFile)
    )
  }

  return [[`!${normalizedExpression(node, sourceFile)}`]]
}

function applyConditions(terms, conditionBranches) {
  if (conditionBranches.length === 0) {
    return []
  }
  return terms.flatMap((term) => {
    return conditionBranches.flatMap((condition) => {
      const combined = combineConditions(term.condition, condition)
      return combined ? [{ ...term, condition: combined }] : []
    })
  })
}

function propertyNameTerms(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return [{ text: name.text, condition: [] }]
  }
  if (ts.isComputedPropertyName(name)) {
    return classTerms(name.expression, sourceFile)
  }
  return []
}

function staticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
    return name.text
  }
  return undefined
}

function objectLiteralClassTerms(node, sourceFile) {
  const terms = []

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const staticName = staticPropertyName(property.name)
    if (staticName && CLASS_CONFIG_PROPERTIES.has(staticName)) {
      terms.push(...classTerms(property.initializer, sourceFile))
      continue
    }

    const nameTerms = propertyNameTerms(property.name, sourceFile)
    if (nameTerms.length === 0) {
      continue
    }

    const literalValue = booleanLiteralValue(property.initializer)
    if (literalValue === false) {
      continue
    }

    const conditions =
      literalValue === true ? [[]] : conditionBranchesForTruthy(property.initializer, sourceFile)
    for (const nameTerm of nameTerms) {
      for (const condition of conditions) {
        const combined = combineConditions(nameTerm.condition, condition)
        if (combined) {
          terms.push({ text: nameTerm.text, condition: combined })
        }
      }
    }
  }

  return terms
}

function templateExpressionClassTerms(node, sourceFile) {
  const terms = [{ text: node.head.text, condition: [] }]

  for (const span of node.templateSpans) {
    terms.push(...classTerms(span.expression, sourceFile))
    terms.push({ text: span.literal.text, condition: [] })
  }

  return terms
}

function calleeIdentifierName(node) {
  if (ts.isIdentifier(node)) {
    return node.text
  }
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text
  }
  return undefined
}

function isClassComposerCall(node) {
  if (!ts.isCallExpression(node)) {
    return false
  }
  const name = calleeIdentifierName(node.expression)
  return name ? CLASS_COMPOSER_FUNCTIONS.has(name) : false
}

function isLikelyClassHelperCall(node) {
  if (!ts.isCallExpression(node)) {
    return false
  }
  const name = calleeIdentifierName(node.expression)
  return name ? CLASS_HELPER_NAME_PATTERN.test(name) : false
}

function propertyAccessMethodName(node) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined
  }
  return node.expression.name.text
}

function propertyAccessReceiver(node) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined
  }
  return node.expression.expression
}

function isBooleanFilterCall(node) {
  if (propertyAccessMethodName(node) !== 'filter' || node.arguments.length !== 1) {
    return false
  }
  const [callback] = node.arguments
  return ts.isIdentifier(callback) && callback.text === 'Boolean'
}

function termsUnsafeAfterFiltering(terms) {
  return terms.filter((term) => hasVerticalScrollClass(term.text))
}

function classTerms(node, sourceFile) {
  if (ts.isTemplateExpression(node)) {
    return templateExpressionClassTerms(node, sourceFile)
  }

  const fragments = stringFragments(node)
  if (fragments.length > 0) {
    return fragments.map((text) => ({ text, condition: [] }))
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return classTerms(node.expression, sourceFile)
  }

  if (ts.isConditionalExpression(node)) {
    const conditionValue = booleanLiteralValue(node.condition)
    if (conditionValue === true) {
      return classTerms(node.whenTrue, sourceFile)
    }
    if (conditionValue === false) {
      return classTerms(node.whenFalse, sourceFile)
    }
    return [
      ...applyConditions(
        classTerms(node.whenTrue, sourceFile),
        conditionBranchesForTruthy(node.condition, sourceFile)
      ),
      ...applyConditions(
        classTerms(node.whenFalse, sourceFile),
        conditionBranchesForFalsy(node.condition, sourceFile)
      )
    ]
  }

  if (ts.isBinaryExpression(node)) {
    const leftValue = booleanLiteralValue(node.left)
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (leftValue === true) {
        return classTerms(node.right, sourceFile)
      }
      if (leftValue === false) {
        return []
      }
      return applyConditions(
        classTerms(node.right, sourceFile),
        conditionBranchesForTruthy(node.left, sourceFile)
      )
    }
    if (
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...classTerms(node.left, sourceFile),
        ...applyConditions(
          classTerms(node.right, sourceFile),
          conditionBranchesForFalsy(node.left, sourceFile)
        )
      ]
    }
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...classTerms(node.left, sourceFile), ...classTerms(node.right, sourceFile)]
    }
  }

  if (ts.isCallExpression(node)) {
    if (isClassComposerCall(node)) {
      return node.arguments.flatMap((argument) => classTerms(argument, sourceFile))
    }
    if (isLikelyClassHelperCall(node)) {
      return node.arguments.flatMap((argument) => classTerms(argument, sourceFile))
    }
    const methodName = propertyAccessMethodName(node)
    const receiver = propertyAccessReceiver(node)
    if (receiver && isBooleanFilterCall(node)) {
      return classTerms(receiver, sourceFile)
    }
    if (receiver && (methodName === 'filter' || methodName === 'slice')) {
      return termsUnsafeAfterFiltering(classTerms(receiver, sourceFile))
    }
    if (methodName && CLASS_CHAIN_RECEIVER_METHODS.has(methodName)) {
      return classTerms(node.expression, sourceFile)
    }
    if (methodName && CLASS_CHAIN_RECEIVER_AND_ARGUMENT_METHODS.has(methodName)) {
      return [
        ...classTerms(node.expression, sourceFile),
        ...node.arguments.flatMap((argument) => classTerms(argument, sourceFile))
      ]
    }
    return []
  }

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return classTerms(node.expression, sourceFile)
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => classTerms(element, sourceFile))
  }

  if (ts.isObjectLiteralExpression(node)) {
    return objectLiteralClassTerms(node, sourceFile)
  }

  return []
}

function isClassNameAttribute(node) {
  return ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className'
}

function classNameAttributeTerms(node, sourceFile) {
  if (!node.initializer) {
    return []
  }
  if (ts.isStringLiteral(node.initializer)) {
    return [{ text: node.initializer.text, condition: [] }]
  }
  if (!ts.isJsxExpression(node.initializer) || !node.initializer.expression) {
    return []
  }
  return classTerms(node.initializer.expression, sourceFile)
}

function reportIfUnstyledVerticalScroll(
  node,
  fragments,
  filePath,
  sourceFile,
  sourceText,
  reports
) {
  if (fragments.some(hasVerticalScrollClass) && !fragments.some(hasStyledScrollbarClass)) {
    const { line, column } = lineAndColumnForPosition(sourceText, node.getStart(sourceFile))
    reports.push({ filePath, line, column, text: fragments.join('${...}').trim() })
  }
}

function conditionImpliesScrollbar(overflowCondition, scrollbarCondition) {
  return scrollbarCondition.every((atom) => overflowCondition.includes(atom))
}

function fixedConditionValues(condition) {
  const values = new Map()
  for (const atom of condition) {
    const name = atomName(atom)
    const value = atomValue(atom)
    if (values.has(name) && values.get(name) !== value) {
      return undefined
    }
    values.set(name, value)
  }
  return values
}

function assignmentSatisfiesCondition(assignment, condition) {
  return condition.every((atom) => assignment.get(atomName(atom)) === atomValue(atom))
}

function conditionSetsCover(overflowCondition, scrollbarConditions) {
  if (scrollbarConditions.length === 0) {
    return false
  }

  if (
    scrollbarConditions.some((scrollbarCondition) =>
      conditionImpliesScrollbar(overflowCondition, scrollbarCondition)
    )
  ) {
    return true
  }

  const fixedValues = fixedConditionValues(overflowCondition)
  if (!fixedValues) {
    return false
  }

  const variableNames = Array.from(
    new Set(scrollbarConditions.flatMap((condition) => condition.map(atomName)))
  ).filter((name) => !fixedValues.has(name))

  if (variableNames.length > 8) {
    return false
  }

  const assignment = new Map(fixedValues)

  function covers(index) {
    if (index === variableNames.length) {
      return scrollbarConditions.some((condition) =>
        assignmentSatisfiesCondition(assignment, condition)
      )
    }

    const name = variableNames[index]
    assignment.set(name, false)
    const falseBranchCovered = covers(index + 1)
    assignment.set(name, true)
    const trueBranchCovered = covers(index + 1)
    assignment.delete(name)

    return falseBranchCovered && trueBranchCovered
  }

  return covers(0)
}

function reportUnstyledClassTerms(node, terms, filePath, sourceFile, sourceText, reports) {
  const offendingTerm = terms.find(
    (term) =>
      hasVerticalScrollClass(term.text) &&
      !conditionSetsCover(
        term.condition,
        terms
          .filter((candidate) => hasStyledScrollbarClass(candidate.text))
          .map((candidate) => candidate.condition)
      )
  )
  if (offendingTerm) {
    const { line, column } = lineAndColumnForPosition(sourceText, node.getStart(sourceFile))
    reports.push({ filePath, line, column, text: offendingTerm.text.trim() })
  }
}

export function reportUnstyledScrollbars(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const reports = []

  function visit(node) {
    if (isClassNameAttribute(node)) {
      reportUnstyledClassTerms(
        node,
        classNameAttributeTerms(node, sourceFile),
        filePath,
        sourceFile,
        sourceText,
        reports
      )
      return
    }

    if (isClassComposerCall(node) || ts.isTemplateExpression(node)) {
      reportUnstyledClassTerms(
        node,
        classTerms(node, sourceFile),
        filePath,
        sourceFile,
        sourceText,
        reports
      )
      return
    }

    const fragments = stringFragments(node)
    reportIfUnstyledVerticalScroll(node, fragments, filePath, sourceFile, sourceText, reports)
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return reports
}

export async function collectUnstyledScrollbarReports(root = process.cwd()) {
  const scanRoot = path.join(root, 'src', 'renderer', 'src')
  const files = await collectSourceFiles(root, scanRoot)
  const reports = []

  for (const filePath of files) {
    const sourceText = await fs.readFile(filePath, 'utf8')
    reports.push(...reportUnstyledScrollbars(filePath, sourceText))
  }

  return reports
}

export function formatReports(root, reports) {
  return reports
    .map(
      (report) =>
        `${normalizePath(root, report.filePath)}:${report.line}:${report.column} ${report.text.replace(/\s+/g, ' ')}`
    )
    .join('\n')
}

export async function main(root = process.cwd()) {
  const reports = await collectUnstyledScrollbarReports(root)
  if (reports.length === 0) {
    return 0
  }

  console.error('Renderer vertical scroll containers must use an Orca scrollbar style.')
  console.error(
    'Add scrollbar-sleek, scrollbar-editor, scrollbar-none, or use the shadcn ScrollArea wrapper.'
  )
  console.error('')
  console.error(formatReports(root, reports))
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
