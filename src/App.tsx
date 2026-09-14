import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  deleteRecipe,
  getFirebaseServices,
  seedIfEmpty,
  subscribeToRecipes,
  subscribeToShoppingItems,
  subscribeToWeeklyMeals,
  upsertRecipe,
  upsertWeeklyMeal
} from './lib/firebase';
import {
  createRecipe,
  createWeeklyMeal,
  dayLabel,
  getMondayForDate,
  parseLines,
  loadAppState,
  saveAppState,
  slotLabel,
} from './lib/storage';
import type { DayKey, MealSlot, Recipe, ShoppingItem, WeeklyMeal } from './lib/types';

const dayOrder: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const mealSlots: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

function createStarterRecipes(): Recipe[] {
  const now = Date.now();

  return [
    {
      id: 'starter-overnight-oats',
      title: 'Overnight Oats',
      servings: 4,
      prepTimeMinutes: 10,
      ingredients: ['Haferflocken', 'Milch oder Pflanzenmilch', 'Joghurt', 'Beeren', 'Honig'],
      instructions: ['Haferflocken und Flüssigkeit mischen.', 'Über Nacht kalt stellen.', 'Vor dem Servieren mit Beeren garnieren.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-vegetable-pasta',
      title: 'Gemüsepasta',
      servings: 4,
      prepTimeMinutes: 25,
      ingredients: ['Nudeln', 'Zucchini', 'Tomaten', 'Olivenöl', 'Knoblauch'],
      instructions: ['Nudeln kochen.', 'Gemüse anbraten.', 'Alles vermengen und abschmecken.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-sheet-pan-tacos',
      title: 'Tacos vom Blech',
      servings: 4,
      prepTimeMinutes: 35,
      ingredients: ['Tortillas', 'Bohnen', 'Paprika', 'Zwiebel', 'Salsa'],
      instructions: ['Füllung rösten.', 'Tortillas erwärmen.', 'Mit Salsa und Toppings anrichten.'],
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createStarterMeals(weekStart: string): WeeklyMeal[] {
  const now = Date.now();

  return [
    {
      id: 'starter-monday-breakfast',
      weekStart,
      day: 'monday',
      slot: 'breakfast',
      recipeId: 'starter-overnight-oats',
      recipeTitle: 'Overnight Oats',
      note: 'Ein einfacher Start in die Woche.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-monday-dinner',
      weekStart,
      day: 'monday',
      slot: 'dinner',
      recipeId: 'starter-vegetable-pasta',
      recipeTitle: 'Gemüsepasta',
      note: 'Übrig gebliebenes Gemüse verwenden.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-wednesday-lunch',
      weekStart,
      day: 'wednesday',
      slot: 'lunch',
      recipeId: 'starter-sheet-pan-tacos',
      recipeTitle: 'Tacos vom Blech',
      note: 'Ideal für ein schnelles Mittagessen.',
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createStarterShopping(): ShoppingItem[] {
  const now = Date.now();

  return [
    { id: 'starter-shopping-oats', name: 'Haferflocken', quantity: 1, unit: 'Packung', aisle: 'Frühstück', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-pasta', name: 'Nudeln', quantity: 2, unit: 'Packungen', aisle: 'Trockenvorräte', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-tortillas', name: 'Tortillas', quantity: 1, unit: 'Packung', aisle: 'Backwaren', checked: false, createdAt: now, updatedAt: now }
  ];
}

function App() {
  const persisted = loadAppState();
  const firebase = useMemo(() => getFirebaseServices(), []);
  const currentWeekStart = useMemo(() => getMondayForDate(new Date()), []);

  const starterRecipes = useMemo(() => createStarterRecipes(), []);
  const starterMeals = useMemo(() => createStarterMeals(currentWeekStart), [currentWeekStart]);
  const starterShopping = useMemo(() => createStarterShopping(), []);

  const [recipes, setRecipes] = useState<Recipe[]>(persisted?.recipes ?? starterRecipes);
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>(persisted?.weeklyMeals ?? starterMeals);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(persisted?.shoppingItems ?? starterShopping);
  const [activeTab, setActiveTab] = useState<'recipes' | 'week' | 'shopping' | null>(null);
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Gemeinsame Synchronisierung wird verbunden ...' : 'Lokaler Modus');
  const [recipeDraft, setRecipeDraft] = useState({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [mealDraft, setMealDraft] = useState<{ day: DayKey; slot: MealSlot; recipeId: string }>({
    day: 'monday',
    slot: 'dinner',
    recipeId: ''
  });
  const [recipeSearch, setRecipeSearch] = useState('');
  const [daySearch, setDaySearch] = useState('');
  const [mealSearch, setMealSearch] = useState('');

  useEffect(() => {
    saveAppState({ recipes, weeklyMeals, shoppingItems });
  }, [recipes, weeklyMeals, shoppingItems]);

  useEffect(() => {
    if (!firebase) {
      return;
    }

    let cancelled = false;
    let unsubscribeRecipes: (() => void) | undefined;
    let unsubscribeMeals: (() => void) | undefined;
    let unsubscribeShopping: (() => void) | undefined;

    void firebase.authReady
      .then(async () => {
        if (cancelled) {
          return;
        }

        const handleSyncError = () => setSyncStatus('Synchronisierung nicht verfügbar');

        unsubscribeRecipes = subscribeToRecipes(firebase.db, setRecipes, handleSyncError);
        unsubscribeMeals = subscribeToWeeklyMeals(firebase.db, setWeeklyMeals, handleSyncError);
        unsubscribeShopping = subscribeToShoppingItems(firebase.db, (items) => {
          setShoppingItems(items);
          setSyncStatus('Gemeinsame Synchronisierung aktiv');
        }, handleSyncError);

        await seedIfEmpty(firebase.db, {
          recipes: recipes.length > 0 ? recipes : starterRecipes,
          weeklyMeals: weeklyMeals.length > 0 ? weeklyMeals : starterMeals,
          shoppingItems: shoppingItems.length > 0 ? shoppingItems : starterShopping
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSyncStatus('Synchronisierung nicht verfügbar');
        }
      });

    return () => {
      cancelled = true;
      unsubscribeRecipes?.();
      unsubscribeMeals?.();
      unsubscribeShopping?.();
    };
  }, [firebase]);

  const weekMeals = useMemo(() => weeklyMeals.filter((meal) => meal.weekStart === currentWeekStart), [currentWeekStart, weeklyMeals]);
  const checkedCount = shoppingItems.filter((item) => item.checked).length;

  function handleRecipeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!recipeDraft.title.trim()) {
      return;
    }

    const recipe = createRecipe({
      title: recipeDraft.title.trim(),
      servings: Number(recipeDraft.servings) || 4,
      prepTimeMinutes: Number(recipeDraft.prepTimeMinutes) || 30,
      ingredients: parseLines(recipeDraft.ingredients),
      instructions: parseLines(recipeDraft.instructions)
    });

    setRecipes((current) => [recipe, ...current]);
    setRecipeDraft({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });

    if (firebase) {
      void upsertRecipe(firebase.db, recipe).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function startEditingRecipe(recipe: Recipe): void {
    setEditingRecipeId(recipe.id);
    setEditingRecipe({ ...recipe });
  }

  function cancelEditingRecipe(): void {
    setEditingRecipeId(null);
    setEditingRecipe(null);
  }

  function saveEditedRecipe(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!editingRecipe || !editingRecipe.title.trim()) {
      return;
    }

    const nextRecipe = { ...editingRecipe, title: editingRecipe.title.trim(), updatedAt: Date.now() };
    setRecipes((current) => current.map((recipe) => (recipe.id === nextRecipe.id ? nextRecipe : recipe)));
    cancelEditingRecipe();

    if (firebase) {
      void upsertRecipe(firebase.db, nextRecipe).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removeRecipe(recipe: Recipe): void {
    if (typeof window !== 'undefined' && !window.confirm(`„${recipe.title}“ wirklich löschen?`)) {
      return;
    }

    setRecipes((current) => current.filter((entry) => entry.id !== recipe.id));

    if (firebase) {
      void deleteRecipe(firebase.db, recipe.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function addMealToWeek(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const recipe = recipes.find((entry) => entry.id === mealDraft.recipeId);

    if (!recipe) {
      return;
    }

    const meal: WeeklyMeal = createWeeklyMeal({
      weekStart: currentWeekStart,
      day: mealDraft.day,
      slot: mealDraft.slot,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      note: ''
    });

    setWeeklyMeals((current) => [
      ...current.filter((entry) => !(entry.weekStart === currentWeekStart && entry.day === meal.day && entry.slot === meal.slot)),
      meal
    ]);
    setMealDraft((current) => ({ ...current, recipeId: '' }));

    if (firebase) {
      void upsertWeeklyMeal(firebase.db, meal).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  const filteredRecipes = recipes.filter((recipe) => recipe.title.toLocaleLowerCase('de-DE').includes(recipeSearch.toLocaleLowerCase('de-DE')));
  const filteredDays = dayOrder.filter((day) => dayLabel(day).toLocaleLowerCase('de-DE').includes(daySearch.toLocaleLowerCase('de-DE')));
  const filteredMealSlots = mealSlots.filter((slot) => slotLabel(slot).toLocaleLowerCase('de-DE').includes(mealSearch.toLocaleLowerCase('de-DE')));

  return (
    <main className="app-shell">
      <section className="hero-card hero-card--wide">
        <div className="hero-copy">
          <p className="eyebrow">Laubhaufen</p>

          <div className="hero-meta">
            <span>{syncStatus}</span>
            <span>{recipes.length} Rezepte</span>
            <span>{weekMeals.length} geplante Mahlzeiten</span>
            <span>{shoppingItems.length} Einkaufsartikel</span>
          </div>
        </div>

        <div className="stats-grid stats-grid--wide">
          <article>
            <strong>{recipes.length}</strong>
            <span>Rezepte</span>
          </article>
          <article>
            <strong>{weekMeals.length}</strong>
            <span>Mahlzeiten diese Woche</span>
          </article>
          <article>
            <strong>{shoppingItems.length}</strong>
            <span>Einkaufsartikel</span>
          </article>
          <article>
            <strong>{checkedCount}</strong>
            <span>Erledigt</span>
          </article>
        </div>
      </section>

      <nav className="tab-bar" aria-label="Bereiche">
        <button className={activeTab === 'recipes' ? 'tab active' : 'tab'} onClick={() => setActiveTab('recipes')} type="button">
          Rezepte
        </button>
        <button className={activeTab === 'week' ? 'tab active' : 'tab'} onClick={() => setActiveTab('week')} type="button">
          Wochenplan
        </button>
        <button className={activeTab === 'shopping' ? 'tab active' : 'tab'} onClick={() => setActiveTab('shopping')} type="button">
          Einkaufsliste
        </button>
      </nav>

      {activeTab === 'recipes' ? (
        <section className="recipe-window" aria-labelledby="recipes-title">
          <div className="recipe-window-heading">
            <div>
              <p className="eyebrow recipe-window-eyebrow">Rezepte</p>
              <h2 id="recipes-title">Alle Rezepte</h2>
            </div>
            <span className="recipe-count">{recipes.length} insgesamt</span>
          </div>

          <div className="recipe-window-grid">
            <form className="composer-card recipe-form" onSubmit={handleRecipeSubmit}>
              <div className="card-heading">
                <h3>Neues Rezept</h3>
                <p>Lege ein Rezept für die gemeinsame Sammlung an.</p>
              </div>

              <label>
                Titel
                <input value={recipeDraft.title} onChange={(event) => setRecipeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Name des Rezepts" required />
              </label>

              <div className="two-column">
                <label>
                  Portionen
                  <input value={recipeDraft.servings} onChange={(event) => setRecipeDraft((current) => ({ ...current, servings: event.target.value }))} min="1" type="number" />
                </label>
                <label>
                  Minuten
                  <input value={recipeDraft.prepTimeMinutes} onChange={(event) => setRecipeDraft((current) => ({ ...current, prepTimeMinutes: event.target.value }))} min="1" type="number" />
                </label>
              </div>

              <label>
                Zutaten, eine pro Zeile
                <textarea value={recipeDraft.ingredients} onChange={(event) => setRecipeDraft((current) => ({ ...current, ingredients: event.target.value }))} rows={5} />
              </label>

              <label>
                Zubereitung, eine pro Zeile
                <textarea value={recipeDraft.instructions} onChange={(event) => setRecipeDraft((current) => ({ ...current, instructions: event.target.value }))} rows={5} />
              </label>

              <button type="submit">Rezept anlegen</button>
            </form>

            <div className="recipe-list" aria-label="Vorhandene Rezepte">
              {recipes.map((recipe) => (
                <article className="recipe-summary" key={recipe.id}>
                  {editingRecipeId === recipe.id && editingRecipe ? (
                    <form className="recipe-edit-form" onSubmit={saveEditedRecipe}>
                      <h3>Rezept bearbeiten</h3>
                      <label>
                        Titel
                        <input value={editingRecipe.title} onChange={(event) => setEditingRecipe((current) => current ? { ...current, title: event.target.value } : current)} required />
                      </label>
                      <div className="two-column">
                        <label>
                          Portionen
                          <input type="number" min="1" value={editingRecipe.servings} onChange={(event) => setEditingRecipe((current) => current ? { ...current, servings: Number(event.target.value) } : current)} />
                        </label>
                        <label>
                          Minuten
                          <input type="number" min="1" value={editingRecipe.prepTimeMinutes} onChange={(event) => setEditingRecipe((current) => current ? { ...current, prepTimeMinutes: Number(event.target.value) } : current)} />
                        </label>
                      </div>
                      <label>
                        Zutaten, eine pro Zeile
                        <textarea rows={4} value={editingRecipe.ingredients.join('\n')} onChange={(event) => setEditingRecipe((current) => current ? { ...current, ingredients: parseLines(event.target.value) } : current)} />
                      </label>
                      <label>
                        Zubereitung, eine pro Zeile
                        <textarea rows={4} value={editingRecipe.instructions.join('\n')} onChange={(event) => setEditingRecipe((current) => current ? { ...current, instructions: parseLines(event.target.value) } : current)} />
                      </label>
                      <div className="recipe-actions">
                        <button type="submit">Änderungen speichern</button>
                        <button type="button" className="button-secondary" onClick={cancelEditingRecipe}>Abbrechen</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="recipe-summary-heading">
                        <h3>{recipe.title}</h3>
                        <span>{recipe.servings} Portionen</span>
                      </div>
                      <p>{recipe.prepTimeMinutes} Minuten Zubereitungszeit</p>
                      <div className="recipe-summary-columns">
                        <div>
                          <strong>Zutaten</strong>
                          <span>{recipe.ingredients.length} Zutaten</span>
                        </div>
                        <div>
                          <strong>Zubereitung</strong>
                          <span>{recipe.instructions.length} Schritte</span>
                        </div>
                      </div>
                      <div className="recipe-actions">
                        <button type="button" onClick={() => startEditingRecipe(recipe)}>Bearbeiten</button>
                        <button type="button" className="button-danger" onClick={() => removeRecipe(recipe)}>Löschen</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'week' ? (
        <section className="week-window" aria-labelledby="week-title">
          <div className="week-window-heading">
            <div>
              <p className="eyebrow week-window-eyebrow">Wochenplan</p>
              <h2 id="week-title">Diese Woche</h2>
            </div>
            <span>Woche ab {currentWeekStart}</span>
          </div>

          <form className="week-planner-form" onSubmit={addMealToWeek}>
            <label>
              Rezept
              <input value={recipeSearch} onChange={(event) => setRecipeSearch(event.target.value)} placeholder="Rezept suchen ..." />
              <select value={mealDraft.recipeId} onChange={(event) => setMealDraft((current) => ({ ...current, recipeId: event.target.value }))} required>
                <option value="">Rezept auswählen</option>
                {filteredRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}
              </select>
            </label>
            <label>
              Tag
              <input value={daySearch} onChange={(event) => setDaySearch(event.target.value)} placeholder="Tag suchen ..." />
              <select value={mealDraft.day} onChange={(event) => setMealDraft((current) => ({ ...current, day: event.target.value as DayKey }))}>
                {filteredDays.map((day) => <option key={day} value={day}>{dayLabel(day)}</option>)}
              </select>
            </label>
            <label>
              Mahlzeit
              <input value={mealSearch} onChange={(event) => setMealSearch(event.target.value)} placeholder="Mahlzeit suchen ..." />
              <select value={mealDraft.slot} onChange={(event) => setMealDraft((current) => ({ ...current, slot: event.target.value as MealSlot }))}>
                {filteredMealSlots.map((slot) => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
              </select>
            </label>
            <button type="submit">Einplanen</button>
          </form>

          <div className="schedule-table" role="table" aria-label="Wochenplan">
            <div className="schedule-row schedule-header" role="row">
              <div className="schedule-day-cell" role="columnheader">Tag</div>
              {mealSlots.map((slot) => (
                <div className="schedule-slot-cell" key={slot} role="columnheader">{slotLabel(slot)}</div>
              ))}
            </div>

            {dayOrder.map((day) => (
              <div className="schedule-row" key={day} role="row">
                <div className="schedule-day-cell" role="rowheader">{dayLabel(day)}</div>
                {mealSlots.map((slot) => {
                  const meal = weekMeals.find((entry) => entry.day === day && entry.slot === slot);

                  return (
                    <div className={meal ? 'schedule-meal-cell has-meal' : 'schedule-meal-cell'} key={slot} role="cell">
                      {meal ? (
                        <>
                          <strong>{meal.recipeTitle}</strong>
                          {meal.note ? <span>{meal.note}</span> : null}
                        </>
                      ) : (
                        <span className="schedule-empty">Noch nicht geplant</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

    </main>
  );
}

export default App;
