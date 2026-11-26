const aliases = {
  chicken_breast: ['куриная грудка', 'филе курицы', 'куриного филе', 'куриной грудки', 'chicken breast'],
  egg: ['яйцо', 'яйца', 'яиц', 'яйца куриные', 'куриные яйца', 'egg', 'eggs'],
  cottage5: ['творог 5', 'творога 5', 'cottage cheese 5'],
  yogurt: ['натуральный йогурт', 'натурального йогурта'],
  oats: ['овсяные хлопья', 'овсянка', 'oats'],
  tomato: ['помидор', 'томат', 'томаты', 'tomato', 'tomatoes'],
  cucumber: ['огурец', 'cucumber'],
  oil: ['оливковое масло', 'подсолнечное масло', 'olive oil'],
  honey: ['honey'],
  chia: ['чиа', 'chia seeds'],
  buckwheat: ['гречневая крупа', 'buckwheat'],
  rice: ['рис белый', 'rice']
};

const ingredientHeading = /^(?:ингредиенты|для рецепта|понадобится|нам понадобится|состав|ingredients)(?=\s|[:：]|$)(?:\s*\([^)]*\))?\s*[:：]?\s*/iu;
const stepsHeading = /^(?:способ приготовления|приготовление|готовим|как приготовить|инструкция|directions|instructions|method)(?:\s*[:：]\s*|\s*$)/iu;
const number = '\\d+(?:[.,]\\d+)?';
const unit = 'кг|kg|гр|г|g|мл|ml|шт|штук|pcs?';
const beforeAmount = new RegExp('^(.+?)(?:\\s*[:–—-]\\s*|\\s+)(' + number + ')\\s*(' + unit + ')\\.?$', 'iu');
const afterAmount = new RegExp('^(' + number + ')\\s*(' + unit + ')?\\.?\\s+(.+)$', 'iu');
const normalize = text => text.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function foodLookup(foods) {
  const items = new Map();
  for (const [key, food] of Object.entries(foods)) {
    for (const variant of [food.name, food.name.split(' (')[0], ...(aliases[key] ?? [])]) {
      const normalized = normalize(variant);
      if (!items.has(normalized)) items.set(normalized, new Set());
      items.get(normalized).add(key);
    }
  }
  return text => {
    const picks = items.get(normalize(text));
    return picks?.size === 1 ? [...picks][0] : '';
  };
}

function ingredient(line, identify, foods) {
  let title = line;
  let amount;
  let units;
  const after = line.match(beforeAmount);
  const before = line.match(afterAmount);
  if (after) [, title, amount, units] = after;
  else if (before) [, amount, units, title] = before;
  const key = identify(title);
  const value = Number(amount?.replace(',', '.'));
  const code = units?.toLowerCase();
  const grams = !Number.isFinite(value) ? null
    : ['кг', 'kg'].includes(code) ? value * 1000
    : ['г', 'гр', 'g'].includes(code) ? value
    : !code || ['шт', 'штук', 'pc', 'pcs'].includes(code) ? foods[key]?.unit_g * value || null
    : null;
  return {key, grams, line};
}

export function parseRecipeText(text, foods) {
  const identify = foodLookup(foods);
  const lines = text.split(/\r?\n/).map(line => line.trim().replace(/^[•●▪–—-]\s*/u, ''))
    .filter(line => line && !/^#|^@/u.test(line));
  const result = {name: '', rows: [], steps: []};
  let section = '';
  for (let line of lines) {
    if (stepsHeading.test(line)) {
      section = 'steps';
      line = line.replace(stepsHeading, '');
    } else if (ingredientHeading.test(line) && section !== 'steps') {
      section = 'ingredients';
      line = line.replace(ingredientHeading, '');
    }
    if (!line) continue;
    if (section === 'steps') {
      result.steps.push(line.replace(/^\d+[.)]\s*/u, ''));
      continue;
    }
    const parts = line.split(/;\s*|,\s+(?=[\p{L}])/u);
    const ingredients = parts.map(part => ingredient(part, identify, foods));
    const foundAmount = ingredients.some(item => item.grams !== null || /\d\s*(?:кг|гр|г|kg|g|мл|ml|шт)\.?\s*$/iu.test(item.line));
    if (section === 'ingredients' || foundAmount) {
      result.rows.push(...ingredients);
    } else if (!result.name && result.rows.length === 0) {
      result.name = line.slice(0, 120);
    }
  }
  return result;
}
