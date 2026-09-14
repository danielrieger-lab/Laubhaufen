import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  deleteRecipe,
  deleteShoppingItem,
  deleteWeeklyMeal,
  getFirebaseServices,
  seedIfEmpty,
  subscribeToRecipes,
  subscribeToShoppingItems,
  subscribeToWeeklyMeals,
  upsertRecipe,
  upsertShoppingItem,
  upsertWeeklyMeal
} from './lib/firebase';
import {
  createRecipe,
  createShoppingItem,
  createWeeklyMeal,
  dayLabel,
  getMondayForDate,
  joinLines,
  loadAppState,
  nextCheckState,
  parseLines,
  saveAppState,
  slotLabel
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

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
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
  const [activeTab, setActiveTab] = useState<'recipes' | 'week' | 'shopping'>('recipes');
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Gemeinsame Synchronisierung wird verbunden ...' : 'Lokaler Modus');

  const [recipeDraft, setRecipeDraft] = useState({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });
  const [mealDraft, setMealDraft] = useState<{ day: DayKey; slot: MealSlot; recipeId: string; note: string }>({
    day: 'monday',
    slot: 'dinner',
    recipeId: '',
    note: ''
  });
  const [shoppingDraft, setShoppingDraft] = useState({ name: '', quantity: '1', unit: 'Stück', aisle: 'Allgemein' });

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

        unsubscribeRecipes = subscribeToRecipes(firebase.db, setRecipes);
        unsubscribeMeals = subscribeToWeeklyMeals(firebase.db, setWeeklyMeals);
        unsubscribeShopping = subscribeToShoppingItems(firebase.db, (items) => {
          setShoppingItems(items);
          setSyncStatus('Gemeinsame Synchronisierung aktiv');
        });

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

  function updateMeal(mealId: string, updater: (meal: WeeklyMeal) => WeeklyMeal): void {
    setWeeklyMeals((current) => current.map((meal) => (meal.id === mealId ? updater(meal) : meal)));
  }

  function updateShopping(itemId: string, updater: (item: ShoppingItem) => ShoppingItem): void {
    setShoppingItems((current) => current.map((item) => (item.id === itemId ? updater(item) : item)));
  }

  async function saveRecipe(recipe: Recipe): Promise<void> {
    const nextRecipe = { ...recipe, updatedAt: Date.now() };
    setRecipes((current) => (current.some((item) => item.id === recipe.id) ? current.map((item) => (item.id === recipe.id ? nextRecipe : item)) : [nextRecipe, ...current]));

    if (firebase) {
      await upsertRecipe(firebase.db, nextRecipe);
    }
  }

  async function saveMeal(meal: WeeklyMeal): Promise<void> {
    const nextMeal = { ...meal, updatedAt: Date.now() };
    setWeeklyMeals((current) => (current.some((item) => item.id === meal.id) ? current.map((item) => (item.id === meal.id ? nextMeal : item)) : [nextMeal, ...current]));

    if (firebase) {
      await upsertWeeklyMeal(firebase.db, nextMeal);
    }
  }

  async function saveShoppingItem(item: ShoppingItem): Promise<void> {
    const nextItem = { ...item, updatedAt: Date.now() };
    setShoppingItems((current) => (current.some((entry) => entry.id === item.id) ? current.map((entry) => (entry.id === item.id ? nextItem : entry)) : [nextItem, ...current]));

    if (firebase) {
      await upsertShoppingItem(firebase.db, nextItem);
    }
  }

  async function deleteRecipeItem(recipeId: string): Promise<void> {
    setRecipes((current) => current.filter((recipe) => recipe.id !== recipeId));
    if (firebase) {
      await deleteRecipe(firebase.db, recipeId);
    }
  }

  async function deleteMealItem(mealId: string): Promise<void> {
    setWeeklyMeals((current) => current.filter((meal) => meal.id !== mealId));
    if (firebase) {
      await deleteWeeklyMeal(firebase.db, mealId);
    }
  }

  async function deleteShoppingItemLocal(itemId: string): Promise<void> {
    setShoppingItems((current) => current.filter((item) => item.id !== itemId));
    if (firebase) {
      await deleteShoppingItem(firebase.db, itemId);
    }
  }

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

    setRecipeDraft({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });
    void saveRecipe(recipe);
  }

  function handleMealSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!mealDraft.recipeId) {
      return;
    }

    const recipe = recipes.find((entry) => entry.id === mealDraft.recipeId);

    const meal = createWeeklyMeal({
      weekStart: currentWeekStart,
      day: mealDraft.day,
      slot: mealDraft.slot,
      recipeId: mealDraft.recipeId,
      recipeTitle: recipe?.title ?? 'Eigenes Gericht',
      note: mealDraft.note.trim()
    });

    setMealDraft({ day: 'monday', slot: 'dinner', recipeId: '', note: '' });
    void saveMeal(meal);
  }

  function handleShoppingSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!shoppingDraft.name.trim()) {
      return;
    }

    const item = createShoppingItem({
      name: shoppingDraft.name.trim(),
      quantity: Number(shoppingDraft.quantity) || 1,
      unit: shoppingDraft.unit.trim() || 'Stück',
      aisle: shoppingDraft.aisle.trim() || 'Allgemein'
    });

    setShoppingDraft({ name: '', quantity: '1', unit: 'Stück', aisle: 'Allgemein' });
    void saveShoppingItem(item);
  }

  const totalIngredients = recipes.reduce((count, recipe) => count + recipe.ingredients.length, 0);

  return (
    <main className="app-shell">
      <section className="hero-card hero-card--wide">
        <div className="hero-copy">
          <p className="eyebrow">Laubhaufen</p>
          <h1>Rezepte, Wochenplanung und Einkaufslisten in einer gemeinsamen PWA.</h1>
          <p className="hero-text">
            Alle bearbeiten dieselben aktuellen Firestore-Daten. Es gibt keinen sichtbaren Anmeldeschritt, aber die App nutzt im Hintergrund eine anonyme Firebase-Anmeldung, damit die gemeinsamen Daten geschützt bleiben.
          </p>

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
        <section className="workspace-grid">
          <form className="composer-card" onSubmit={handleRecipeSubmit}>
            <div className="card-heading">
              <h2>Rezept hinzufügen</h2>
              <p>Zutaten und Zubereitung als gemeinsames, bearbeitbares Rezept speichern.</p>
            </div>

            <label>
              Titel
              <input value={recipeDraft.title} onChange={(event) => setRecipeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Name des Rezepts" />
            </label>

            <div className="two-column">
              <label>
                Portionen
                <input value={recipeDraft.servings} onChange={(event) => setRecipeDraft((current) => ({ ...current, servings: event.target.value }))} min="1" type="number" />
              </label>
              <label>
                Zubereitungszeit
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

            <button type="submit">Rezept speichern</button>
          </form>

          <div className="content-column">
            <article className="list-card">
              <div className="card-heading inline">
                <div>
                  <h2>Rezepte</h2>
                  <p>{totalIngredients} Zutaten in allen Rezepten</p>
                </div>
              </div>

              <div className="item-list">
                {recipes.map((recipe) => (
                  <RecipeCard key={recipe.id} recipe={recipe} onSave={saveRecipe} onDelete={() => void deleteRecipeItem(recipe.id)} />
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === 'week' ? (
        <section className="workspace-grid">
          <form className="composer-card" onSubmit={handleMealSubmit}>
            <div className="card-heading">
              <h2>Mahlzeit planen</h2>
              <p>Ein Rezept einem beliebigen Platz im aktuellen Wochenplan zuweisen.</p>
            </div>

            <label>
              Rezept
              <select value={mealDraft.recipeId} onChange={(event) => setMealDraft((current) => ({ ...current, recipeId: event.target.value }))}>
                <option value="">Rezept auswählen</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="two-column">
              <label>
                Tag
                <select value={mealDraft.day} onChange={(event) => setMealDraft((current) => ({ ...current, day: event.target.value as DayKey }))}>
                  {dayOrder.map((day) => (
                    <option key={day} value={day}>
                      {dayLabel(day)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mahlzeit
                <select value={mealDraft.slot} onChange={(event) => setMealDraft((current) => ({ ...current, slot: event.target.value as MealSlot }))}>
                  {mealSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabel(slot)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Notiz
              <textarea value={mealDraft.note} onChange={(event) => setMealDraft((current) => ({ ...current, note: event.target.value }))} rows={4} />
            </label>

            <button type="submit">Mahlzeit speichern</button>
          </form>

          <div className="content-column">
            <article className="list-card schedule-card">
              <div className="card-heading inline">
                <div>
                  <h2>Diese Woche</h2>
                  <p>Woche ab {currentWeekStart}</p>
                </div>
              </div>

              <div className="weekly-grid">
                {dayOrder.map((day) => (
                  <div key={day} className="weekly-day">
                    <header>
                      <strong>{dayLabel(day)}</strong>
                      <span>{weekMeals.filter((meal) => meal.day === day).length} Mahlzeiten</span>
                    </header>

                    <div className="weekly-day-meals">
                      {mealSlots.map((slot) => {
                        const slotEntry = weekMeals.find((meal) => meal.day === day && meal.slot === slot);

                        return slotEntry ? (
                          <WeeklyMealCard key={slot} meal={slotEntry} recipes={recipes} onSave={saveMeal} onDelete={() => void deleteMealItem(slotEntry.id)} onEdit={(nextMeal) => updateMeal(slotEntry.id, () => nextMeal)} />
                        ) : (
                          <div key={slot} className="meal-slot meal-slot-empty">
                            <span className="meal-slot-label">{slotLabel(slot)}</span>
                            <span>Keine Mahlzeit geplant</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === 'shopping' ? (
        <section className="workspace-grid">
          <form className="composer-card" onSubmit={handleShoppingSubmit}>
            <div className="card-heading">
              <h2>Einkaufsartikel hinzufügen</h2>
              <p>Die Liste synchron halten und Einkäufe nach dem Besorgen abhaken.</p>
            </div>

            <label>
              Artikel
              <input value={shoppingDraft.name} onChange={(event) => setShoppingDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Mehl" />
            </label>

            <div className="two-column">
              <label>
                Menge
                <input value={shoppingDraft.quantity} onChange={(event) => setShoppingDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="1" />
              </label>
              <label>
                Einheit
                <input value={shoppingDraft.unit} onChange={(event) => setShoppingDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="kg, Packung, Flasche" />
              </label>
            </div>

            <label>
              Bereich
              <input value={shoppingDraft.aisle} onChange={(event) => setShoppingDraft((current) => ({ ...current, aisle: event.target.value }))} placeholder="Obst und Gemüse" />
            </label>

            <button type="submit">Artikel speichern</button>
          </form>

          <div className="content-column">
            <article className="list-card">
              <div className="card-heading inline">
                <div>
                  <h2>Einkaufsliste</h2>
                  <p>{checkedCount} von {shoppingItems.length} erledigt</p>
                </div>
              </div>

              <div className="item-list">
                {shoppingItems.map((item) => (
                  <ShoppingCard
                    key={item.id}
                    item={item}
                    onToggle={() => updateShopping(item.id, (current) => ({ ...current, checked: nextCheckState(current.checked), updatedAt: Date.now() }))}
                    onSave={saveShoppingItem}
                    onDelete={() => void deleteShoppingItemLocal(item.id)}
                  />
                ))}
              </div>
            </article>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function RecipeCard({ recipe, onSave, onDelete }: { recipe: Recipe; onSave: (recipe: Recipe) => Promise<void>; onDelete: () => void }) {
  const [draft, setDraft] = useState(recipe);

  useEffect(() => {
    setDraft(recipe);
  }, [recipe]);

  function persist(): void {
    void onSave({ ...draft, updatedAt: Date.now() });
  }

  return (
    <article className="entry-card recipe-card">
      <header>
        <div>
          <p className="entry-kind">Rezept</p>
          <input className="inline-input title-input" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, updatedAt: Date.now() }))} onBlur={persist} />
        </div>
        <span className="status-pill">{draft.servings} Portionen</span>
      </header>

      <div className="two-column recipe-meta">
        <label>
          Portionen
          <input type="number" min="1" value={draft.servings} onChange={(event) => setDraft((current) => ({ ...current, servings: Number(event.target.value), updatedAt: Date.now() }))} onBlur={persist} />
        </label>
        <label>
          Zubereitungszeit
          <input type="number" min="1" value={draft.prepTimeMinutes} onChange={(event) => setDraft((current) => ({ ...current, prepTimeMinutes: Number(event.target.value), updatedAt: Date.now() }))} onBlur={persist} />
        </label>
      </div>

      <div className="recipe-columns">
        <label>
          Zutaten
          <textarea value={joinLines(draft.ingredients)} onChange={(event) => setDraft((current) => ({ ...current, ingredients: parseLines(event.target.value), updatedAt: Date.now() }))} onBlur={persist} rows={5} />
        </label>
        <label>
          Zubereitung
          <textarea value={joinLines(draft.instructions)} onChange={(event) => setDraft((current) => ({ ...current, instructions: parseLines(event.target.value), updatedAt: Date.now() }))} onBlur={persist} rows={5} />
        </label>
      </div>

      <footer>
        <span>{formatDate(recipe.updatedAt)}</span>
        <div className="entry-actions entry-actions--compact">
          <button type="button" onClick={persist}>
            Speichern
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Löschen
          </button>
        </div>
      </footer>
    </article>
  );
}

function WeeklyMealCard({
  meal,
  recipes,
  onSave,
  onDelete,
  onEdit
}: {
  meal: WeeklyMeal;
  recipes: Recipe[];
  onSave: (meal: WeeklyMeal) => Promise<void>;
  onDelete: () => void;
  onEdit: (nextMeal: WeeklyMeal) => void;
}) {
  const [draft, setDraft] = useState(meal);

  useEffect(() => {
    setDraft(meal);
  }, [meal]);

  function persist(): void {
    const nextMeal = { ...draft, updatedAt: Date.now() };
    onEdit(nextMeal);
    void onSave(nextMeal);
  }

  return (
    <article className="meal-card">
      <div className="meal-card-top">
        <strong>{slotLabel(draft.slot)}</strong>
        <span>{draft.recipeTitle}</span>
      </div>

      <select
        value={draft.recipeId}
        onChange={(event) => {
          const selected = recipes.find((recipe) => recipe.id === event.target.value);
          setDraft((current) => ({ ...current, recipeId: event.target.value, recipeTitle: selected?.title ?? 'Eigenes Gericht', updatedAt: Date.now() }));
        }}
        onBlur={persist}
      >
        <option value="">Eigenes Gericht</option>
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.title}
          </option>
        ))}
      </select>

      <textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value, updatedAt: Date.now() }))} onBlur={persist} rows={3} placeholder="Optionale Notiz" />

      <div className="entry-actions entry-actions--compact">
        <button type="button" onClick={persist}>
          Speichern
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Löschen
        </button>
      </div>
    </article>
  );
}

function ShoppingCard({
  item,
  onToggle,
  onSave,
  onDelete
}: {
  item: ShoppingItem;
  onToggle: () => void;
  onSave: (item: ShoppingItem) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(item);

  useEffect(() => {
    setDraft(item);
  }, [item]);

  function persist(): void {
    void onSave({ ...draft, updatedAt: Date.now() });
  }

  return (
    <article className={draft.checked ? 'shopping-card checked' : 'shopping-card'}>
      <label className="shopping-inline">
        <input type="checkbox" checked={draft.checked} onChange={onToggle} />
        <input className="inline-input title-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value, updatedAt: Date.now() }))} onBlur={persist} />
      </label>

      <div className="two-column">
        <input type="number" min="1" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: Number(event.target.value), updatedAt: Date.now() }))} onBlur={persist} />
        <input value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value, updatedAt: Date.now() }))} onBlur={persist} />
      </div>

      <input value={draft.aisle} onChange={(event) => setDraft((current) => ({ ...current, aisle: event.target.value, updatedAt: Date.now() }))} onBlur={persist} placeholder="Bereich" />

      <div className="entry-actions entry-actions--compact">
        <button type="button" onClick={persist}>
          Speichern
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Löschen
        </button>
      </div>
    </article>
  );
}

export default App;
