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
      title: 'Overnight oats',
      servings: 4,
      prepTimeMinutes: 10,
      ingredients: ['rolled oats', 'milk or plant milk', 'yogurt', 'berries', 'honey'],
      instructions: ['Mix the oats and liquid.', 'Chill overnight.', 'Top with berries before serving.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-vegetable-pasta',
      title: 'Vegetable pasta',
      servings: 4,
      prepTimeMinutes: 25,
      ingredients: ['pasta', 'zucchini', 'tomatoes', 'olive oil', 'garlic'],
      instructions: ['Cook the pasta.', 'Sauté vegetables.', 'Combine and season to taste.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-sheet-pan-tacos',
      title: 'Sheet-pan tacos',
      servings: 4,
      prepTimeMinutes: 35,
      ingredients: ['tortillas', 'beans', 'peppers', 'onion', 'salsa'],
      instructions: ['Roast the filling.', 'Warm tortillas.', 'Assemble with salsa and toppings.'],
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
      recipeTitle: 'Overnight oats',
      note: 'Simple start for the week.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-monday-dinner',
      weekStart,
      day: 'monday',
      slot: 'dinner',
      recipeId: 'starter-vegetable-pasta',
      recipeTitle: 'Vegetable pasta',
      note: 'Use any leftover vegetables.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-wednesday-lunch',
      weekStart,
      day: 'wednesday',
      slot: 'lunch',
      recipeId: 'starter-sheet-pan-tacos',
      recipeTitle: 'Sheet-pan tacos',
      note: 'Good for a quick lunch.',
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createStarterShopping(): ShoppingItem[] {
  const now = Date.now();

  return [
    { id: 'starter-shopping-oats', name: 'rolled oats', quantity: 1, unit: 'bag', aisle: 'Breakfast', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-pasta', name: 'pasta', quantity: 2, unit: 'packs', aisle: 'Dry goods', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-tortillas', name: 'tortillas', quantity: 1, unit: 'pack', aisle: 'Bakery', checked: false, createdAt: now, updatedAt: now }
  ];
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
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
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Connecting shared sync...' : 'Local mode');

  const [recipeDraft, setRecipeDraft] = useState({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });
  const [mealDraft, setMealDraft] = useState<{ day: DayKey; slot: MealSlot; recipeId: string; note: string }>({
    day: 'monday',
    slot: 'dinner',
    recipeId: '',
    note: ''
  });
  const [shoppingDraft, setShoppingDraft] = useState({ name: '', quantity: '1', unit: 'item', aisle: 'General' });

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
          setSyncStatus('Shared sync active');
        });

        await seedIfEmpty(firebase.db, {
          recipes: recipes.length > 0 ? recipes : starterRecipes,
          weeklyMeals: weeklyMeals.length > 0 ? weeklyMeals : starterMeals,
          shoppingItems: shoppingItems.length > 0 ? shoppingItems : starterShopping
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSyncStatus('Sync unavailable');
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
      recipeTitle: recipe?.title ?? 'Custom meal',
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
      unit: shoppingDraft.unit.trim() || 'item',
      aisle: shoppingDraft.aisle.trim() || 'General'
    });

    setShoppingDraft({ name: '', quantity: '1', unit: 'item', aisle: 'General' });
    void saveShoppingItem(item);
  }

  const totalIngredients = recipes.reduce((count, recipe) => count + recipe.ingredients.length, 0);

  return (
    <main className="app-shell">
      <section className="hero-card hero-card--wide">
        <div className="hero-copy">
          <p className="eyebrow">Laubhaufen</p>
          <h1>Recipes, weekly meals, and shopping lists in one shared PWA.</h1>
          <p className="hero-text">
            Everyone edits the same live Firestore data. There is no visible login step, but the app uses anonymous Firebase auth behind the scenes so the shared data stays protected.
          </p>

          <div className="hero-meta">
            <span>{syncStatus}</span>
            <span>{recipes.length} recipes</span>
            <span>{weekMeals.length} planned meals</span>
            <span>{shoppingItems.length} shopping items</span>
          </div>
        </div>

        <div className="stats-grid stats-grid--wide">
          <article>
            <strong>{recipes.length}</strong>
            <span>Recipes</span>
          </article>
          <article>
            <strong>{weekMeals.length}</strong>
            <span>Meals this week</span>
          </article>
          <article>
            <strong>{shoppingItems.length}</strong>
            <span>Shopping items</span>
          </article>
          <article>
            <strong>{checkedCount}</strong>
            <span>Checked off</span>
          </article>
        </div>
      </section>

      <nav className="tab-bar" aria-label="Sections">
        <button className={activeTab === 'recipes' ? 'tab active' : 'tab'} onClick={() => setActiveTab('recipes')} type="button">
          Recipes
        </button>
        <button className={activeTab === 'week' ? 'tab active' : 'tab'} onClick={() => setActiveTab('week')} type="button">
          Weekly schedule
        </button>
        <button className={activeTab === 'shopping' ? 'tab active' : 'tab'} onClick={() => setActiveTab('shopping')} type="button">
          Shopping list
        </button>
      </nav>

      {activeTab === 'recipes' ? (
        <section className="workspace-grid">
          <form className="composer-card" onSubmit={handleRecipeSubmit}>
            <div className="card-heading">
              <h2>Add recipe</h2>
              <p>Store ingredients and instructions as a shared editable recipe.</p>
            </div>

            <label>
              Title
              <input value={recipeDraft.title} onChange={(event) => setRecipeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Recipe title" />
            </label>

            <div className="two-column">
              <label>
                Servings
                <input value={recipeDraft.servings} onChange={(event) => setRecipeDraft((current) => ({ ...current, servings: event.target.value }))} min="1" type="number" />
              </label>
              <label>
                Prep time
                <input value={recipeDraft.prepTimeMinutes} onChange={(event) => setRecipeDraft((current) => ({ ...current, prepTimeMinutes: event.target.value }))} min="1" type="number" />
              </label>
            </div>

            <label>
              Ingredients, one per line
              <textarea value={recipeDraft.ingredients} onChange={(event) => setRecipeDraft((current) => ({ ...current, ingredients: event.target.value }))} rows={5} />
            </label>

            <label>
              Instructions, one per line
              <textarea value={recipeDraft.instructions} onChange={(event) => setRecipeDraft((current) => ({ ...current, instructions: event.target.value }))} rows={5} />
            </label>

            <button type="submit">Save recipe</button>
          </form>

          <div className="content-column">
            <article className="list-card">
              <div className="card-heading inline">
                <div>
                  <h2>Recipes</h2>
                  <p>{totalIngredients} ingredients across all recipes</p>
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
              <h2>Plan a meal</h2>
              <p>Assign a recipe to any meal slot in the current week.</p>
            </div>

            <label>
              Recipe
              <select value={mealDraft.recipeId} onChange={(event) => setMealDraft((current) => ({ ...current, recipeId: event.target.value }))}>
                <option value="">Choose a recipe</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="two-column">
              <label>
                Day
                <select value={mealDraft.day} onChange={(event) => setMealDraft((current) => ({ ...current, day: event.target.value as DayKey }))}>
                  {dayOrder.map((day) => (
                    <option key={day} value={day}>
                      {dayLabel(day)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Meal
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
              Note
              <textarea value={mealDraft.note} onChange={(event) => setMealDraft((current) => ({ ...current, note: event.target.value }))} rows={4} />
            </label>

            <button type="submit">Save meal slot</button>
          </form>

          <div className="content-column">
            <article className="list-card schedule-card">
              <div className="card-heading inline">
                <div>
                  <h2>This week</h2>
                  <p>Week starting {currentWeekStart}</p>
                </div>
              </div>

              <div className="weekly-grid">
                {dayOrder.map((day) => (
                  <div key={day} className="weekly-day">
                    <header>
                      <strong>{dayLabel(day)}</strong>
                      <span>{weekMeals.filter((meal) => meal.day === day).length} meals</span>
                    </header>

                    <div className="weekly-day-meals">
                      {mealSlots.map((slot) => {
                        const slotEntry = weekMeals.find((meal) => meal.day === day && meal.slot === slot);

                        return slotEntry ? (
                          <WeeklyMealCard key={slot} meal={slotEntry} recipes={recipes} onSave={saveMeal} onDelete={() => void deleteMealItem(slotEntry.id)} onEdit={(nextMeal) => updateMeal(slotEntry.id, () => nextMeal)} />
                        ) : (
                          <div key={slot} className="meal-slot meal-slot-empty">
                            <span className="meal-slot-label">{slotLabel(slot)}</span>
                            <span>No meal planned</span>
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
              <h2>Add shopping item</h2>
              <p>Keep the list synced and check things off as they are bought.</p>
            </div>

            <label>
              Item
              <input value={shoppingDraft.name} onChange={(event) => setShoppingDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Flour" />
            </label>

            <div className="two-column">
              <label>
                Quantity
                <input value={shoppingDraft.quantity} onChange={(event) => setShoppingDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="1" />
              </label>
              <label>
                Unit
                <input value={shoppingDraft.unit} onChange={(event) => setShoppingDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="kg, pack, bottle" />
              </label>
            </div>

            <label>
              Aisle
              <input value={shoppingDraft.aisle} onChange={(event) => setShoppingDraft((current) => ({ ...current, aisle: event.target.value }))} placeholder="Produce" />
            </label>

            <button type="submit">Save item</button>
          </form>

          <div className="content-column">
            <article className="list-card">
              <div className="card-heading inline">
                <div>
                  <h2>Shopping list</h2>
                  <p>{checkedCount} of {shoppingItems.length} checked</p>
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
          <p className="entry-kind">Recipe</p>
          <input className="inline-input title-input" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value, updatedAt: Date.now() }))} onBlur={persist} />
        </div>
        <span className="status-pill">{draft.servings} servings</span>
      </header>

      <div className="two-column recipe-meta">
        <label>
          Servings
          <input type="number" min="1" value={draft.servings} onChange={(event) => setDraft((current) => ({ ...current, servings: Number(event.target.value), updatedAt: Date.now() }))} onBlur={persist} />
        </label>
        <label>
          Prep time
          <input type="number" min="1" value={draft.prepTimeMinutes} onChange={(event) => setDraft((current) => ({ ...current, prepTimeMinutes: Number(event.target.value), updatedAt: Date.now() }))} onBlur={persist} />
        </label>
      </div>

      <div className="recipe-columns">
        <label>
          Ingredients
          <textarea value={joinLines(draft.ingredients)} onChange={(event) => setDraft((current) => ({ ...current, ingredients: parseLines(event.target.value), updatedAt: Date.now() }))} onBlur={persist} rows={5} />
        </label>
        <label>
          Instructions
          <textarea value={joinLines(draft.instructions)} onChange={(event) => setDraft((current) => ({ ...current, instructions: parseLines(event.target.value), updatedAt: Date.now() }))} onBlur={persist} rows={5} />
        </label>
      </div>

      <footer>
        <span>{formatDate(recipe.updatedAt)}</span>
        <div className="entry-actions entry-actions--compact">
          <button type="button" onClick={persist}>
            Save
          </button>
          <button type="button" className="danger" onClick={onDelete}>
            Delete
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
          setDraft((current) => ({ ...current, recipeId: event.target.value, recipeTitle: selected?.title ?? 'Custom meal', updatedAt: Date.now() }));
        }}
        onBlur={persist}
      >
        <option value="">Custom meal</option>
        {recipes.map((recipe) => (
          <option key={recipe.id} value={recipe.id}>
            {recipe.title}
          </option>
        ))}
      </select>

      <textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value, updatedAt: Date.now() }))} onBlur={persist} rows={3} placeholder="Optional note" />

      <div className="entry-actions entry-actions--compact">
        <button type="button" onClick={persist}>
          Save
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
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

      <input value={draft.aisle} onChange={(event) => setDraft((current) => ({ ...current, aisle: event.target.value, updatedAt: Date.now() }))} onBlur={persist} placeholder="Aisle" />

      <div className="entry-actions entry-actions--compact">
        <button type="button" onClick={persist}>
          Save
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  );
}

export default App;
