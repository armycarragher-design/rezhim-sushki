import catalog from './catalog.js';
import {addDays, dateKey, format, makeMenu, monday, round} from './menu.js';

const storageKey = 'rezhim-sushki/pages/v1';
const emptyState = () => ({
  version: 1, profile: null, foods: {}, recipes: [], prefs: {}, swaps: {}, legacy: {},
  eaten: {}, weights: [], measures: [], extras: [], habits: [], coach_notes: [], coach_log: []
});
const screen = document.querySelector('#screen');
const status = document.querySelector('#status');
const dialog = document.querySelector('#dialog');
const today = () => dateKey(new Date());
let week = monday(today());
let day = (new Date().getDay() + 6) % 7;
let state = emptyState();
const dateLabel = key => new Date(key + 'T12:00:00').toLocaleDateString('ru-RU');
const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const fullDays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = Number.isFinite;
const between = (value, lo, hi) => finite(value) && value >= lo && value <= hi;
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const measures = ['neck', 'waist', 'hip'];
const menuDefaults = {
  activity: 'light', mode: 'standard', meals: 4, sweet: true, adjust: 0, exclusions: ['beef']
};
const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
const dateValid = value => typeof value === 'string' && dateFormat.test(value);
const own = (record, key) => Object.hasOwn(record, key);
const numericNutrients = row => ['kcal', 'p', 'f', 'c'].every(key => finite(row[key]) && row[key] >= 0);

function validate(data) {
  if (!object(data) || data.version !== 1) throw Error('Выберите JSON-файл резервной копии «Режим сушки».');
  const result = {...emptyState(), ...data};
  const p = result.profile;
  const valid = p === null || (object(p) && ['m', 'f'].includes(p.sex) &&
    between(p.age, 14, 90) && between(p.height, 120, 220) && between(p.weight, 35, 350) &&
    between(p.bf, 5, 60) && (p.lbm == null || between(p.lbm, 1, 350)) &&
    own(catalog.activity, p.activity) && own(catalog.modes, p.mode) &&
    [3, 4, 5].includes(p.meals) && finite(p.adjust) &&
    strings(p.exclusions) && [0, 1, true, false].includes(p.sweet));
  const validFood = ([key, row]) => /^c[\w-]+$/.test(key) && object(row) && typeof row.name === 'string' &&
    numericNutrients(row) && (row.unit_g == null || row.unit_g > 0 && finite(row.unit_g)) &&
    (row.unit_g == null || typeof row.unit === 'string');
  const validRecipe = row => object(row) && /^u[\w-]+$/.test(row.id) && typeof row.name === 'string' &&
    finite(row.minutes) && strings(row.meals) && row.meals.every(key => own(catalog.pools, key)) &&
    strings(row.steps) && Array.isArray(row.ingredients) && row.ingredients.every(part =>
      Array.isArray(part) && typeof part[0] === 'string' && finite(part[1]) && part[1] > 0);
  const mapValues = (key, check) => object(result[key]) && Object.values(result[key]).every(check);
  const rows = (key, check) => Array.isArray(result[key]) && result[key].every(row => object(row) && check(row));
  if (!valid || !object(result.foods) || !Object.entries(result.foods).every(validFood) ||
      !rows('recipes', validRecipe) || !mapValues('prefs', item => ['fav', 'hide'].includes(item)) ||
      !mapValues('swaps', item => typeof item === 'string') || !mapValues('legacy', item => typeof item === 'string') ||
      !mapValues('eaten', item => typeof item === 'boolean') ||
      !rows('weights', row => dateValid(row.day) && finite(row.weight)) ||
      !rows('measures', row => dateValid(row.day) && measures.every(k => row[k] == null || finite(row[k]))) ||
      !rows('extras', row => dateValid(row.day) && typeof row.name === 'string' && numericNutrients(row)) ||
      !rows('habits', row => dateValid(row.day) && finite(row.water) && finite(row.steps)) ||
      !rows('coach_notes', row => dateValid(row.day) && typeof row.note === 'string') ||
      !rows('coach_log', row => typeof row.ts === 'string' && typeof row.action === 'string' && typeof row.details === 'string')) {
    throw Error('В резервной копии есть данные в неизвестном формате.');
  }
  return Object.fromEntries(Object.keys(emptyState()).map(key => [key, result[key]]));
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) state = validate(JSON.parse(saved));
} catch {
  status.textContent = 'Не удалось прочитать данные этого браузера. Загрузите резервную копию.';
}

function update(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    status.textContent = 'Браузер не сохранил изменения. Проверьте доступное место и настройки хранения.';
    status.scrollIntoView({block: 'nearest'});
    return false;
  }
  state = next;
  status.textContent = '';
  return true;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (typeof value === 'boolean') el.toggleAttribute(key, value);
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter(child => child !== null && child !== undefined));
  return el;
}

const button = (label, action, classes = 'btn ghost small-btn', attrs = {}) =>
  h('button', {class: classes, type: 'button', onclick: action, ...attrs}, label);
const card = (...children) => h('section', {class: 'card stack'}, children);
const note = (text, classes = 'note warn') => h('p', {class: classes}, text);
const macros = t => `Б ${round(t.p)} · Ж ${round(t.f)} · У ${round(t.c)}`;
const dayKey = () => addDays(week, day);

function nutrients(total, plan) {
  return h('div', {class: 'sumrow'}, [
    ['kcal', 'ккал'], ['p', 'белки'], ['f', 'жиры'], ['c', 'углеводы']
  ].map(([key, label]) => h('div', {}, h('span', {class: 'v'}, round(total[key])),
    h('span', {class: 'l'}, label + (plan ? ` · цель ${plan[key]}` : '')))));
}

function weekControls() {
  function move(amount) {
    week = addDays(week, amount);
    render();
  }
  return h('div', {class: 'week-controls'},
    button('Пред. неделя', () => move(-7)),
    h('strong', {}, `${dateLabel(week)} – ${dateLabel(addDays(week, 6))}`),
    button('След. неделя', () => move(7)),
    week !== monday(today()) ? button('Текущая', () => {
      week = monday(today());
      day = (new Date().getDay() + 6) % 7;
      render();
    }) : null);
}

function dayControls() {
  return h('nav', {class: 'daytabs', 'aria-label': 'День недели'}, days.map((name, i) =>
    button(name, () => { day = i; render(); }, i === day ? 'btn small-btn' : 'btn ghost small-btn',
      {'aria-pressed': String(i === day), 'aria-label': fullDays[i], 'aria-current': addDays(week, i) === today() ? 'date' : null})));
}

function setPreference(id, current, next) {
  const prefs = {...state.prefs};
  if (current === next) delete prefs[id];
  else prefs[id] = next;
  if (update({...state, prefs})) render();
}

function finishDialog() {
  dialog.close();
  render();
}

function chooseDish(menu, meal) {
  const {slot, recipe} = meal;
  const choices = menu.candidates(slot).filter(r => r.id !== recipe.id).sort((a, b) =>
    Number(!!b.custom) - Number(!!a.custom) || a.name.localeCompare(b.name, 'ru'));
  const search = h('input', {type: 'search', placeholder: 'Найти блюдо', 'aria-label': 'Найти блюдо'});
  const list = h('div', {class: 'recipe-list'});
  const key = `${week}/${day}/${slot}`;
  function show() {
    const found = choices.filter(r => r.name.toLowerCase().includes(search.value.trim().toLowerCase()));
    list.replaceChildren(...found.map(r => h('div', {class: 'recipe-choice card'},
      h('h3', {}, r.name), button('Выбрать', () => {
        if (update({...state, swaps: {...state.swaps, [key]: r.id}})) finishDialog();
      }))));
    if (!found.length) list.append(h('p', {}, 'Подходящих блюд нет.'));
  }
  search.addEventListener('input', show);
  dialog.replaceChildren(h('div', {class: 'stack'},
    h('div', {class: 'head-row'}, h('h2', {}, 'Заменить блюдо'), button('Закрыть', () => dialog.close())),
    state.swaps[key] || state.legacy[key] ? button('Вернуть автоматический выбор', () => {
      if (update({...state, swaps: {...state.swaps, [key]: ''}})) finishDialog();
    }) : null, search, list));
  show();
  dialog.showModal();
  search.focus();
}

function mealCard(meal, menu) {
  const {slot, recipe, total} = meal;
  const pref = state.prefs[recipe.id];
  const mark = `${dayKey()}/${slot}`;
  return h('article', {class: 'meal card', id: slot},
    h('header', {}, h('span', {class: 'slot'}, `${catalog.icons[slot]} ${catalog.names[slot]}`),
      h('span', {class: 'kc'}, `${round(total.kcal)} ккал`)),
    h('h3', {}, recipe.name, recipe.custom ? h('span', {class: 'tag'}, 'моё') : null),
    h('p', {class: 'muted small'}, `${recipe.minutes} мин · ${macros(total)}`),
    recipe.source ? h('p', {class: 'muted small'}, recipe.source) : null,
    h('ul', {class: 'items'}, meal.ingredients.map(item => h('li', {}, h('span', {}, item.name), h('b', {}, item.label)))),
    h('details', {}, h('summary', {}, 'Как приготовить'),
      h('ol', {class: 'steps'}, recipe.steps.map(step => h('li', {}, step)))),
    h('div', {class: 'row-gap'}, button('Заменить блюдо', () => chooseDish(menu, meal)),
      button('♥', () => setPreference(recipe.id, pref, 'fav'), pref === 'fav' ? 'heart on' : 'heart',
        {'aria-label': pref === 'fav' ? 'Убрать из любимых' : 'В любимые'}),
      h('label', {class: 'meal-mark'}, h('input', {type: 'checkbox', checked: !!state.eaten[mark], onchange: event => {
        const eaten = {...state.eaten};
        if (event.target.checked) eaten[mark] = true;
        else delete eaten[mark];
        if (!update({...state, eaten})) event.target.checked = !event.target.checked;
      }}), ' Съедено')));
}

function menuPage(menu) {
  const current = menu.days[day];
  const missing = menu.slots.filter(slot => !current.meals.some(meal => meal.slot === slot));
  return [h('div', {class: 'head-row'}, h('h1', {}, 'Меню на неделю'),
    h('a', {class: 'btn ghost', href: '#shopping'}, 'Список покупок')),
  weekControls(), dayControls(),
  h('section', {class: 'card daysum'}, h('h2', {}, fullDays[day] + (dayKey() === today() ? ' · сегодня' : '')),
    nutrients(current.total, menu.plan)),
  menu.plan.extreme ? note('Выбран экстремальный режим. Порции маленькие, это может быть опасно для здоровья.', 'note danger') : null,
  missing.length ? note(`Нет подходящих блюд для следующих приёмов пищи: ${missing.map(s => catalog.names[s].toLowerCase()).join(', ')}.`) : null,
  h('section', {class: 'meals'}, current.meals.map(meal => mealCard(meal, menu)))];
}

function select(name, entries, value) {
  return h('select', {name}, entries.map(([key, label]) => h('option', {value: key, selected: String(value) === String(key)}, label)));
}

function field(title, name, value, min, max, step = 'any', required = true) {
  return h('label', {}, title, h('input', {type: 'number', name, value, min, max, step, required}));
}

function profilePage() {
  const p = state.profile ?? {sex: 'm', age: 30, height: 175, weight: 75, bf: 25, ...menuDefaults};
  const form = h('form', {class: 'card stack gap'}, h('div', {class: 'form-fields'},
    h('label', {}, 'Пол', select('sex', [['m', 'Мужской'], ['f', 'Женский']], p.sex)),
    field('Возраст', 'age', p.age, 14, 90, 1), field('Рост, см', 'height', p.height, 120, 220),
    field('Вес, кг', 'weight', p.weight, 35, 350), field('Процент жира', 'bf', p.bf, 5, 60),
    h('label', {}, 'Активность', select('activity', Object.entries(catalog.activity).map(([k, v]) => [k, v[1]]), p.activity)),
    h('label', {}, 'Режим', select('mode', Object.entries(catalog.modes).map(([k, v]) => [k, v.title]), p.mode)),
    h('label', {}, 'Приёмов пищи', select('meals', [[3, '3'], [4, '4'], [5, '5']], p.meals)),
    field('Поправка калорий, ккал', 'adjust', p.adjust, -500, 500, 1)),
    h('label', {}, h('input', {name: 'sweet', type: 'checkbox', checked: !!p.sweet}), ' Добавлять десерт'),
    h('fieldset', {}, h('legend', {}, 'Исключить из меню'),
      h('div', {class: 'checks'}, Object.entries(catalog.exclusions).map(([key, [name]]) =>
        h('label', {}, h('input', {type: 'checkbox', name: 'exclusions', value: key, checked: p.exclusions.includes(key)}), ' ' + name)))),
    h('div', {class: 'row-gap'},
      h('button', {class: 'btn', type: 'submit'}, 'Сохранить и открыть меню'),
      state.profile ? button('Подставить стандарт меню', () => {
        for (const key of ['activity', 'mode', 'meals', 'adjust']) {
          form.elements.namedItem(key).value = menuDefaults[key];
        }
        form.elements.namedItem('sweet').checked = menuDefaults.sweet;
        for (const input of form.querySelectorAll('input[name=exclusions]')) {
          input.checked = menuDefaults.exclusions.includes(input.value);
        }
      }) : null));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const profile = {...p, ...Object.fromEntries(data)};
    for (const key of ['age', 'height', 'weight', 'bf', 'meals', 'adjust']) profile[key] = Number(profile[key]);
    profile.sweet = data.has('sweet');
    profile.exclusions = data.getAll('exclusions');
    if (profile.lbm == null || profile.weight !== p.weight || profile.bf !== p.bf) { profile.lbm = round(profile.weight * (1 - profile.bf / 100) * 10) / 10; }

    const weights = state.profile?.weight === profile.weight ? state.weights
      : upsertByDate(state.weights, {day: today(), weight: profile.weight});
    if (update({...state, profile, weights})) { location.hash = 'menu'; render(); }
  });
  return [h('h1', {}, 'Анкета'), !state.profile ? h('p', {},
    'Проверьте параметры или загрузите резервную копию, чтобы восстановить свой профиль и блюда.') : null, form];
}

function upsertByDate(rows, row) {
  return [...rows.filter(item => item.day !== row.day), row];
}

function shoppingPage(menu) {
  const dates = Array.from({length: 7}, (_, i) => [i, fullDays[i]]);
  const start = select('start', dates, 0);
  const end = select('end', dates, 6);
  const output = h('div', {class: 'stack'});
  function show() {
    const totals = new Map();
    const first = Number(start.value);
    const last = Number(end.value);
    if (first > last) {
      output.replaceChildren(note('Конечный день должен быть после начального.'));
      return;
    }
    for (const current of menu.days.slice(first, last + 1)) {
      for (const meal of current.meals) {
        for (const item of meal.ingredients) totals.set(item.key, (totals.get(item.key) ?? 0) + item.grams);
      }
    }
    output.replaceChildren(...[...catalog.categories, ['custom', 'Мои продукты']].flatMap(([key, name]) => {
      const items = [...totals.entries()].filter(([id]) => menu.foods[id].cat === key)
        .sort(([a], [b]) => menu.foods[a].name.localeCompare(menu.foods[b].name, 'ru'));
      return items.length ? [card(h('h2', {}, name), h('ul', {class: 'items'}, items.map(([id, grams]) => {
        const food = menu.foods[id];
        const amount = food.unit_g ? `${format(grams / food.unit_g)} ${food.unit}`
          : grams >= 1000 ? `${format(grams / 1000)} кг` : `${format(grams)} г`;
        return h('li', {}, h('span', {}, food.name), h('b', {}, amount));
      })))] : [];
    }));
    if (!totals.size) output.append(note('В этот период в меню нет блюд.'));
  }
  start.addEventListener('change', show);
  end.addEventListener('change', show);
  show();
  return [h('h1', {}, 'Список покупок'), weekControls(), card(h('div', {class: 'form-fields'},
    h('label', {}, 'С начала дня', start), h('label', {}, 'До конца дня', end))), output];
}

function diaryPage(menu) {
  const date = dayKey();
  const meals = menu.days[day].meals.filter(meal => state.eaten[`${date}/${meal.slot}`]);
  const extras = state.extras.filter(row => row.day === date);
  const all = [...meals.map(meal => meal.total), ...extras];
  const total = Object.fromEntries(['kcal', 'p', 'f', 'c'].map(key => [key, all.reduce((sum, row) => sum + row[key], 0)]));
  const habits = state.habits.find(row => row.day === date) ?? {water: 0, steps: 0};
  const extraForm = h('form', {class: 'stack'}, h('h3', {}, 'Добавить съеденное'),
    h('label', {}, 'Продукт или блюдо', h('input', {type: 'text', name: 'name', required: true, maxlength: 120})),
    h('div', {class: 'form-fields'}, field('Калории', 'kcal', null, 0, 10000),
      field('Белки, г', 'p', 0, 0, 1000), field('Жиры, г', 'f', 0, 0, 1000), field('Углеводы, г', 'c', 0, 0, 1000)),
    h('button', {type: 'submit', class: 'btn'}, 'Добавить'));
  extraForm.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(extraForm);
    const name = String(data.get('name')).trim();
    if (!name) return;
    const row = {day: date, name, ...Object.fromEntries(['kcal', 'p', 'f', 'c'].map(key => [key, Number(data.get(key))]))};
    if (update({...state, extras: [...state.extras, row]})) render();
  });
  const habitsForm = h('form', {class: 'stack'}, h('div', {class: 'form-fields'},
    field('Вода, мл', 'water', habits.water, 0, 20000, 1), field('Шаги', 'steps', habits.steps, 0, 100000, 1)),
    h('button', {type: 'submit', class: 'btn'}, 'Сохранить воду и шаги'));
  habitsForm.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(habitsForm);
    const row = {day: date, water: Number(data.get('water')), steps: Number(data.get('steps'))};
    if (update({...state, habits: upsertByDate(state.habits, row)})) render();
  });
  return [h('h1', {}, 'Дневник питания'), weekControls(), dayControls(),
    card(h('h2', {}, dateLabel(date)), nutrients(total, menu.plan),
      meals.length || extras.length ? h('ul', {class: 'items'},
        ...meals.map(meal => h('li', {}, meal.recipe.name, h('b', {}, `${round(meal.total.kcal)} ккал`))),
        ...extras.map(row => h('li', {}, `${row.name} · ${format(row.kcal)} ккал`,
          button('Удалить', () => { if (update({...state, extras: state.extras.filter(item => item !== row)})) render(); }))))
        : h('p', {}, 'Отметьте блюда в меню или добавьте съеденное здесь.')),
    card(extraForm), card(habitsForm)];
}

function recipesPage(menu) {
  const search = h('input', {type: 'search', placeholder: 'Найти блюдо', 'aria-label': 'Найти блюдо'});
  const filter = select('filter', [['all', 'Все блюда'], ['featured', 'Сохранённые рецепты'], ['mine', 'Мои блюда'], ['fav', 'Любимые'], ['hide', 'Скрытые']], 'all');
  const output = h('div', {class: 'recipe-list'});
  function show() {
    const found = menu.recipes.filter(r => r.name.toLowerCase().includes(search.value.trim().toLowerCase()) &&
      (filter.value === 'all' || (filter.value === 'mine' ? r.custom : filter.value === 'featured' ? r.featured : filter.value === state.prefs[r.id])));
    output.replaceChildren(...found.map(r => {
      const pref = state.prefs[r.id];
      return card(h('details', {}, h('summary', {}, r.name + (r.custom ? ' · моё' : '')),
        h('ul', {class: 'items'}, r.ingredients.flatMap(([key, grams]) => menu.foods[key]
          ? [h('li', {}, menu.foods[key].name, h('b', {}, `${format(grams)} г`))] : [])),
        h('ol', {class: 'steps'}, r.steps.map(step => h('li', {}, step)))),
        h('div', {class: 'row-gap'}, button(pref === 'fav' ? 'Убрать из любимых' : 'В любимые', () => {
          setPreference(r.id, pref, 'fav');
        }), button(pref === 'hide' ? 'Вернуть в меню' : 'Скрыть из меню', () => {
          setPreference(r.id, pref, 'hide');
        })));
    }));
    if (!found.length) output.append(h('p', {}, 'Блюд нет.'));
  }
  search.addEventListener('input', show);
  filter.addEventListener('change', show);
  show();
  return [h('h1', {}, 'Блюда'), card(h('div', {class: 'form-fields'}, search, filter)), output];
}

function weightPage() {
  const form = h('form', {class: 'card stack'}, h('div', {class: 'form-fields'},
    h('label', {}, 'Дата', h('input', {type: 'date', name: 'day', value: today(), required: true})),
    field('Вес, кг', 'weight', state.profile.weight, 35, 350), field('Шея, см', 'neck', null, 20, 60, 'any', false),
    field('Талия, см', 'waist', null, 40, 200, 'any', false), field('Бёдра, см', 'hip', null, 50, 200, 'any', false)),
    h('button', {type: 'submit', class: 'btn'}, 'Записать'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const date = data.get('day');
    const weight = Number(data.get('weight'));
    const weights = upsertByDate(state.weights, {day: date, weight});
    const present = Object.fromEntries(measures.filter(key => data.get(key) !== '').map(key => [key, Number(data.get(key))]));
    const prior = state.measures.find(row => row.day === date);
    const rows = Object.keys(present).length ? upsertByDate(state.measures, {...prior, day: date, ...present}) : state.measures;
    const latest = weights.reduce((a, b) => a.day >= b.day ? a : b);
    if (update({...state, profile: {...state.profile, weight: latest.weight}, weights, measures: rows})) render();
  });
  return [h('h1', {}, 'Вес и замеры'), form,
    card(h('h2', {}, 'Вес'), h('ul', {class: 'items'}, [...state.weights].sort((a, b) => b.day.localeCompare(a.day))
      .map(row => h('li', {}, dateLabel(row.day), h('b', {}, `${format(row.weight)} кг`))))),
    card(h('h2', {}, 'Замеры'), h('ul', {class: 'items'}, [...state.measures].sort((a, b) => b.day.localeCompare(a.day))
      .map(row => h('li', {}, dateLabel(row.day), ['neck', 'waist', 'hip'].flatMap((key, i) => row[key] == null ? []
        : [`${['Шея', 'Талия', 'Бёдра'][i]} ${format(row[key])} см`]).join(' · ')))))];
}

function render() {
  const pages = {menu: menuPage, diary: diaryPage, shopping: shoppingPage, recipes: recipesPage, weight: weightPage, profile: profilePage};
  const route = location.hash.slice(1);
  const page = !state.profile ? 'profile' : own(pages, route) ? route : 'menu';
  document.querySelectorAll('.top nav a').forEach(a => {
    const active = a.hash === '#' + page;
    a.classList.toggle('on', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  screen.replaceChildren(...pages[page](state.profile && ['menu', 'diary', 'shopping', 'recipes'].includes(page)
    ? makeMenu(state, week) : null).filter(Boolean));
}

document.querySelector('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'}));
  h('a', {href: url, download: `rezhim-sushki-${today()}.json`}).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const file = document.querySelector('#file');
document.querySelector('#import').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const selected = file.files[0];
  file.value = '';
  if (!selected) return;
  try {
    if (selected.size > 8 * 1024 * 1024) throw Error('Этот файл слишком большой для резервной копии.');
    const data = validate(JSON.parse((await selected.text()).replace(/^\uFEFF/, '')));
    const load = () => {
      if (update(data)) {
        dialog.close();
        location.hash = 'menu';
        render();
        status.textContent = 'Данные загружены в этот браузер.';
      }
    };
    if (!state.profile) {
      load();
      return;
    }
    dialog.replaceChildren(h('div', {class: 'stack'}, h('h2', {}, 'Загрузить данные из файла?'),
      h('p', {}, 'Текущие записи в этом браузере будут заменены. При необходимости сначала скачайте копию.'),
      h('div', {class: 'row-gap'}, button('Отмена', () => dialog.close()), button('Загрузить', load, 'btn'))));
    dialog.showModal();
  } catch (error) {
    status.textContent = error instanceof SyntaxError ? 'Не удалось прочитать JSON-файл.' : error.message;
  }
});

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue) {
    state = validate(JSON.parse(event.newValue));
    render();
  }
});
render();
