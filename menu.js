import catalog from './catalog.js';
import savedRecipes from './saved-recipes.js';

function recipeSignature(recipe) {
  const {name, meals, minutes, ingredients, steps} = recipe;
  return JSON.stringify([name, meals, minutes, ingredients, steps]);
}

export function round(value) {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + (lower % 2 !== 0) : Math.round(value);
}

export function planFor(p) {
  const lbm = p.lbm ?? round(p.weight * (1 - p.bf / 100) * 10) / 10;
  const tdee = (370 + 21.6 * lbm) * catalog.activity[p.activity][0];
  const mode = catalog.modes[p.mode];
  const wanted = mode.kg * 7700 / 30;
  const deficit = mode.extreme ? wanted : Math.min(wanted, p.weight * 0.01 * 7700 / 7);
  const floor = mode.extreme ? (p.sex === 'f' ? 1000 : 1300) : (p.sex === 'f' ? 1200 : 1500);
  let kcal = Math.max(floor, tdee - deficit + p.adjust);
  const protein = lbm * 2;
  const fat = lbm * 0.8;
  const carbs = Math.max(60, (kcal - 4 * protein - 9 * fat) / 4);
  kcal = Math.max(kcal, 4 * protein + 9 * fat + 4 * carbs);
  return {kcal: round(kcal / 10) * 10, p: round(protein), f: round(fat), c: round(carbs), tdee: round(tdee), lbm, extreme: mode.extreme};
}

const nutrients = ['kcal', 'p', 'f', 'c'];
const empty = () => ({kcal: 0, p: 0, f: 0, c: 0});
const clamp = value => Math.min(2.2, Math.max(0.5, value));

export function makeMenu(state, week) {
  const p = state.profile;
  const plan = planFor(p);
  const foods = {...catalog.foods, ...state.foods};
  const savedSignatures = new Set(savedRecipes.map(recipeSignature));
  const importedSignatures = new Set(state.recipes.map(recipeSignature));
  const recipes = [
    ...catalog.recipes,
    ...savedRecipes.filter(recipe => !importedSignatures.has(recipeSignature(recipe))),
    ...state.recipes.map(recipe => savedSignatures.has(recipeSignature(recipe))
      ? {...recipe, featured: true} : recipe)
  ];
  const byId = new Map(recipes.map(r => [r.id, r]));
  const blocked = new Set(p.exclusions.flatMap(key => catalog.exclusions[key]?.[1] || []));
  const slots = [...catalog.slots[p.meals], ...(p.sweet ? ['dessert'] : [])];
  const shares = p.sweet
    ? {...Object.fromEntries(Object.entries(catalog.shares[p.meals]).map(([slot, share]) => [slot, share * 0.9])), dessert: 0.1}
    : catalog.shares[p.meals];

  function portion(recipe, factor) {
    const total = empty();
    const ingredients = [];
    for (const [key, base] of recipe.ingredients) {
      const food = foods[key];
      if (!food) continue;
      const amount = base * factor;
      const grams = food.unit_g ? Math.max(0.5, round(amount / food.unit_g * 2) / 2) * food.unit_g
        : amount < 30 ? Math.max(1, round(amount)) : round(amount / 5) * 5;
      for (const key of nutrients) total[key] += food[key] * grams / 100;
      ingredients.push({key, grams, name: food.name, label: food.unit_g
        ? `${format(grams / food.unit_g)} ${food.unit} (${format(grams)} г)` : `${format(grams)} г`});
    }
    return {total, ingredients};
  }

  const bases = new Map(recipes.map(r => [r.id, portion(r, 1).total]));
  const baseKcal = r => Math.max(1, bases.get(r.id).kcal);
  const candidates = slot => recipes.filter(r => r.meals.includes(catalog.pools[slot])
    && state.prefs[r.id] !== 'hide' && !r.ingredients.some(([key]) => blocked.has(key)));
  const chosen = new Map();
  for (const pool of new Set(slots.map(slot => catalog.pools[slot]))) {
    const scored = candidates(pool).map(r => {
      const base = bases.get(r.id);
      const macroError = ['p', 'f', 'c'].reduce((sum, key) => {
        const factor = key === 'f' ? 9 : 4;
        return sum + Math.abs(base[key] * factor / baseKcal(r) - plan[key] * factor / plan.kcal);
      }, 0);
      return {r, score: macroError + randomness(week + ':' + pool + ':' + r.id) * 0.3 - ((r.custom || r.featured) ? 0.25 : 0)};
    });
    scored.sort((a, b) => Number(state.prefs[b.r.id] === 'fav') - Number(state.prefs[a.r.id] === 'fav') || a.score - b.score);
    chosen.set(pool, scored.slice(0, catalog.repeats[pool]).map(entry => entry.r));
  }

  const days = Array.from({length: 7}, (_, day) => {
    const picks = slots.flatMap(slot => {
      const options = chosen.get(catalog.pools[slot]);
      const picked = state.swaps[`${week}/${day}/${slot}`] ?? state.legacy[`${week}/${day}/${slot}`];
      const manual = byId.get(picked);
      const valid = manual?.meals.includes(catalog.pools[slot]) && state.prefs[manual.id] !== 'hide'
        && !manual.ingredients.some(([key]) => blocked.has(key));
      const recipe = valid ? manual : options[(day + Number(slot === 'snack2')) % options.length];
      return recipe ? [{slot, recipe, factor: clamp(shares[slot] * plan.kcal / baseKcal(recipe))}] : [];
    });
    let factors = picks.map(pick => pick.factor);
    const totalAt = values => picks.reduce((sum, pick, i) => sum + portion(pick.recipe, values[i]).total.kcal, 0);
    let best = factors;
    let bestError = Math.abs(totalAt(factors) - plan.kcal);
    for (let i = 0; i < 12; i++) {
      const total = totalAt(factors);
      if (!total) break;
      const ratio = 1 + (plan.kcal / total - 1) * (i < 6 ? 0.9 : 0.5);
      factors = factors.map(factor => clamp(factor * ratio));
      const error = Math.abs(totalAt(factors) - plan.kcal);
      if (error < bestError) {
        best = factors;
        bestError = error;
      }
    }
    const total = empty();
    const meals = picks.map(({slot, recipe}, i) => {
      const result = portion(recipe, best[i]);
      for (const key of nutrients) total[key] += result.total[key];
      return {slot, recipe, ingredients: result.ingredients, total: result.total};
    });
    return {meals, total};
  });
  return {plan, days, foods, recipes, slots, candidates};
}

function randomness(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export const format = n => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1}).format(n);

export function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function addDays(key, days) {
  const date = new Date(key + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function monday(key) {
  return addDays(key, -((new Date(key + 'T12:00:00').getDay() + 6) % 7));
}
