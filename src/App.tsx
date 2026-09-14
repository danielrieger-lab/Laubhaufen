import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  deleteRecipe,
  deletePantryItem,
  deleteShoppingItem,
  deleteWeeklyMeal,
  getFirebaseServices,
  subscribeToPantryItems,
  seedIfEmpty,
  subscribeToRecipes,
  subscribeToShoppingItems,
  subscribeToWeeklyMeals,
  upsertRecipe,
  upsertPantryItem,
  upsertShoppingItem,
  upsertWeeklyMeal
} from './lib/firebase';
import {
  createRecipe,
  createShoppingItem,
  createWeeklyMeal,
  createId,
  dayLabel,
  getMondayForDate,
  parseLines,
  loadAppState,
  nextCheckState,
  saveAppState,
  slotLabel,
} from './lib/storage';
import type { DayKey, MealSlot, PantryItem, Recipe, ShoppingItem, WeeklyMeal } from './lib/types';

const dayOrder: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const mealSlots: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const starterRecipeIds = ['starter-overnight-oats', 'starter-vegetable-pasta', 'starter-sheet-pan-tacos'];
const starterMealIds = ['starter-monday-breakfast', 'starter-monday-dinner', 'starter-wednesday-lunch'];

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

  const starterShopping = useMemo(() => createStarterShopping(), []);

  const [recipes, setRecipes] = useState<Recipe[]>(() => (persisted?.recipes ?? []).filter((recipe) => !starterRecipeIds.includes(recipe.id)));
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>(() => (persisted?.weeklyMeals ?? []).filter((meal) => !starterMealIds.includes(meal.id)));
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(persisted?.shoppingItems ?? starterShopping);
  const [pantryItems, setPantryItems] = useState<PantryItem[]>(persisted?.pantryItems ?? []);
  const [activeTab, setActiveTab] = useState<'recipes' | 'week' | 'shopping' | 'pantry' | null>(null);
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Gemeinsame Synchronisierung wird verbunden ...' : 'Lokaler Modus');
  const [recipeDraft, setRecipeDraft] = useState({ title: '', servings: '4', prepTimeMinutes: '30', ingredients: '', instructions: '' });
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingPantryId, setEditingPantryId] = useState<string | null>(null);
  const [editingPantry, setEditingPantry] = useState<PantryItem | null>(null);
  const [slotInputs, setSlotInputs] = useState<Record<string, string>>({});
  const [shoppingDraft, setShoppingDraft] = useState({ name: '', quantity: '1', unit: 'Stück' });
  const [pantryDraft, setPantryDraft] = useState({ name: '', quantity: '1', unit: 'Stück' });

  useEffect(() => {
    saveAppState({ recipes, weeklyMeals, shoppingItems, pantryItems });
  }, [recipes, weeklyMeals, shoppingItems, pantryItems]);

  useEffect(() => {
    if (!firebase) {
      return;
    }

    let cancelled = false;
    let unsubscribeRecipes: (() => void) | undefined;
    let unsubscribeMeals: (() => void) | undefined;
    let unsubscribeShopping: (() => void) | undefined;
    let unsubscribePantry: (() => void) | undefined;

    void firebase.authReady
      .then(async () => {
        if (cancelled) {
          return;
        }

        const handleSyncError = () => setSyncStatus('Synchronisierung nicht verfügbar');

        await Promise.all([
          ...starterRecipeIds.map((recipeId) => deleteRecipe(firebase.db, recipeId)),
          ...starterMealIds.map((mealId) => deleteWeeklyMeal(firebase.db, mealId))
        ]);

        unsubscribeRecipes = subscribeToRecipes(firebase.db, (items) => setRecipes(items.filter((recipe) => !starterRecipeIds.includes(recipe.id))), handleSyncError);
        unsubscribeMeals = subscribeToWeeklyMeals(firebase.db, setWeeklyMeals, handleSyncError);
        unsubscribeShopping = subscribeToShoppingItems(firebase.db, (items) => {
          setShoppingItems(items);
          setSyncStatus('Gemeinsame Synchronisierung aktiv');
        }, handleSyncError);
        unsubscribePantry = subscribeToPantryItems(firebase.db, setPantryItems, handleSyncError);

        await seedIfEmpty(firebase.db, {
          recipes,
          weeklyMeals,
          shoppingItems: shoppingItems.length > 0 ? shoppingItems : starterShopping,
          pantryItems
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
      unsubscribePantry?.();
    };
  }, [firebase]);

  const weekMeals = useMemo(() => weeklyMeals.filter((meal) => meal.weekStart === currentWeekStart), [currentWeekStart, weeklyMeals]);
  const checkedCount = shoppingItems.filter((item) => item.checked).length;

  function recipeAvailability(recipe: Recipe | undefined): 'complete' | 'partial' | 'missing' {
    if (!recipe || recipe.ingredients.length === 0) {
      return 'complete';
    }

    const pantryNames = new Set(pantryItems.map((item) => item.name.trim().toLocaleLowerCase('de-DE')));
    const availableCount = recipe.ingredients.filter((ingredient) => pantryNames.has(ingredient.trim().toLocaleLowerCase('de-DE'))).length;
    const ratio = availableCount / recipe.ingredients.length;

    return ratio >= 1 ? 'complete' : ratio >= 0.5 ? 'partial' : 'missing';
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

  function setMealForSlot(day: DayKey, slot: MealSlot, recipeTitle: string): void {
    const slotKey = `${day}-${slot}`;
    setSlotInputs((current) => ({ ...current, [slotKey]: recipeTitle }));
    const recipe = recipes.find((entry) => entry.title === recipeTitle.trim());
    const existingMeal = weekMeals.find((entry) => entry.day === day && entry.slot === slot);

    if (!recipe) {
      if (!recipeTitle.trim() && existingMeal) {
        setWeeklyMeals((current) => current.filter((entry) => entry.id !== existingMeal.id));
        if (firebase) {
          void deleteWeeklyMeal(firebase.db, existingMeal.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
        }
      }
      return;
    }

    const meal = createWeeklyMeal({
      weekStart: currentWeekStart,
      day,
      slot,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      note: ''
    });

    setWeeklyMeals((current) => [
      ...current.filter((entry) => !(entry.weekStart === currentWeekStart && entry.day === day && entry.slot === slot)),
      meal
    ]);

    if (firebase) {
      void upsertWeeklyMeal(firebase.db, meal).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }

    addRecipeIngredientsToShopping(recipe);
  }

  function addRecipeIngredientsToShopping(recipe: Recipe): void {
    const existingNames = new Set(shoppingItems.map((item) => item.name.trim().toLocaleLowerCase('de-DE')));
    const newItems = recipe.ingredients
      .map((ingredient) => ingredient.trim())
      .filter((ingredient) => ingredient && !existingNames.has(ingredient.toLocaleLowerCase('de-DE')))
      .map((ingredient) => createShoppingItem({
        name: ingredient,
        quantity: 1,
        unit: 'Stück',
        aisle: 'Allgemein'
      }));

    if (newItems.length === 0) {
      return;
    }

    setShoppingItems((current) => [
      ...newItems.filter((item) => !current.some((entry) => entry.name.toLocaleLowerCase('de-DE') === item.name.toLocaleLowerCase('de-DE'))),
      ...current
    ]);

    if (firebase) {
      void Promise.all(newItems.map((item) => upsertShoppingItem(firebase.db, item))).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function toggleShoppingItem(item: ShoppingItem): void {
    if (!item.checked) {
      const existingPantry = pantryItems.find((entry) => entry.name.trim().toLocaleLowerCase('de-DE') === item.name.trim().toLocaleLowerCase('de-DE'));
      const pantryItem: PantryItem = existingPantry
        ? { ...existingPantry, quantity: existingPantry.quantity + item.quantity, updatedAt: Date.now() }
        : { id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, createdAt: Date.now(), updatedAt: Date.now() };

      setPantryItems((current) => existingPantry
        ? current.map((entry) => (entry.id === existingPantry.id ? pantryItem : entry))
        : [pantryItem, ...current]);
      setShoppingItems((current) => current.filter((entry) => entry.id !== item.id));

      if (firebase) {
        void upsertPantryItem(firebase.db, pantryItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
        void deleteShoppingItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
      }
      return;
    }

    const nextItem = { ...item, checked: nextCheckState(item.checked), updatedAt: Date.now() };
    setShoppingItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));

    if (firebase) {
      void upsertShoppingItem(firebase.db, nextItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removeShoppingItem(item: ShoppingItem): void {
    setShoppingItems((current) => current.filter((entry) => entry.id !== item.id));

    if (firebase) {
      void deleteShoppingItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removePantryItem(item: PantryItem): void {
    setPantryItems((current) => current.filter((entry) => entry.id !== item.id));

    if (firebase) {
      void deletePantryItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function addShoppingItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!shoppingDraft.name.trim()) {
      return;
    }

    const item = createShoppingItem({
      name: shoppingDraft.name.trim(),
      quantity: Math.max(0, Number(shoppingDraft.quantity) || 1),
      unit: shoppingDraft.unit.trim() || 'Stück',
      aisle: 'Manuell'
    });

    setShoppingItems((current) => [item, ...current]);
    setShoppingDraft({ name: '', quantity: '1', unit: 'Stück' });

    if (firebase) {
      void upsertShoppingItem(firebase.db, item).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function addPantryItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!pantryDraft.name.trim()) {
      return;
    }

    const normalizedName = pantryDraft.name.trim().toLocaleLowerCase('de-DE');
    const existingItem = pantryItems.find((item) => item.name.trim().toLocaleLowerCase('de-DE') === normalizedName);
    const item: PantryItem = existingItem
      ? { ...existingItem, quantity: existingItem.quantity + Math.max(0, Number(pantryDraft.quantity) || 1), unit: pantryDraft.unit.trim() || existingItem.unit, updatedAt: Date.now() }
      : { id: createId(), name: pantryDraft.name.trim(), quantity: Math.max(0, Number(pantryDraft.quantity) || 1), unit: pantryDraft.unit.trim() || 'Stück', createdAt: Date.now(), updatedAt: Date.now() };

    setPantryItems((current) => existingItem
      ? current.map((entry) => (entry.id === existingItem.id ? item : entry))
      : [item, ...current]);
    setPantryDraft({ name: '', quantity: '1', unit: 'Stück' });

    if (firebase) {
      void upsertPantryItem(firebase.db, item).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function startEditingPantry(item: PantryItem): void {
    setEditingPantryId(item.id);
    setEditingPantry({ ...item });
  }

  function cancelEditingPantry(): void {
    setEditingPantryId(null);
    setEditingPantry(null);
  }

  function saveEditedPantry(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!editingPantry || !editingPantry.name.trim() || editingPantry.quantity < 0) {
      return;
    }

    const nextItem = {
      ...editingPantry,
      name: editingPantry.name.trim(),
      unit: editingPantry.unit.trim() || 'Stück',
      updatedAt: Date.now()
    };

    setPantryItems((current) => current.map((item) => (item.id === nextItem.id ? nextItem : item)));
    cancelEditingPantry();

    if (firebase) {
      void upsertPantryItem(firebase.db, nextItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

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
          Speiseplan
        </button>
        <button className={activeTab === 'shopping' ? 'tab active' : 'tab'} onClick={() => setActiveTab('shopping')} type="button">
          Einkaufsliste
        </button>
        <button className={activeTab === 'pantry' ? 'tab active' : 'tab'} onClick={() => setActiveTab('pantry')} type="button">
          Vorratskammer
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
                    <div className={`schedule-meal-cell ${meal ? `has-meal recipe-${recipeAvailability(recipes.find((recipe) => recipe.id === meal.recipeId) ?? recipes[0])}` : ''}`} key={slot} role="cell">
                      <span className="schedule-meal-label">{slotLabel(slot)}</span>
                      <select
                        className="slot-recipe-field"
                        value={slotInputs[`${day}-${slot}`] ?? meal?.recipeTitle ?? ''}
                        onChange={(event) => setMealForSlot(day, slot, event.target.value)}
                        aria-label={`${dayLabel(day)} ${slotLabel(slot)} Rezept`}
                      >
                        <option value="">Rezept auswählen ...</option>
                        {recipes.map((recipe) => <option className={`recipe-option-${recipeAvailability(recipe)}`} key={recipe.id} value={recipe.title}>{recipe.title}</option>)}
                      </select>
                      {!meal ? <span className="schedule-empty">Noch nicht geplant</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'shopping' ? (
        <section className="shopping-window" aria-labelledby="shopping-title">
          <div className="shopping-window-heading">
            <div>
              <p className="eyebrow shopping-window-eyebrow">Einkaufsliste</p>
              <h2 id="shopping-title">Benötigte Zutaten</h2>
            </div>
            <span>{checkedCount} von {shoppingItems.length} erledigt</span>
          </div>

          <form className="manual-item-form" onSubmit={addShoppingItem}>
            <input value={shoppingDraft.name} onChange={(event) => setShoppingDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Zutat" aria-label="Zutat" required />
            <input value={shoppingDraft.quantity} onChange={(event) => setShoppingDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="0" step="any" placeholder="Menge" aria-label="Menge" required />
            <input value={shoppingDraft.unit} onChange={(event) => setShoppingDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="Einheit" aria-label="Einheit" />
            <button type="submit">Zutat hinzufügen</button>
          </form>

          <div className="shopping-list" aria-label="Einkaufsartikel">
            {shoppingItems.length === 0 ? (
              <p className="shopping-empty">Noch keine Zutaten auf der Einkaufsliste.</p>
            ) : (
              shoppingItems.map((item) => (
                <div className={item.checked ? 'shopping-item checked' : 'shopping-item'} key={item.id}>
                  <label className="shopping-item-main">
                    <input type="checkbox" checked={item.checked} onChange={() => toggleShoppingItem(item)} />
                    <span>{item.name}</span>
                  </label>
                  <span className="shopping-item-meta">{item.quantity} {item.unit}</span>
                  <button type="button" className="button-danger shopping-delete" onClick={() => removeShoppingItem(item)} aria-label={`${item.name} löschen`}>Löschen</button>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'pantry' ? (
        <section className="shopping-window" aria-labelledby="pantry-title">
          <div className="shopping-window-heading">
            <div>
              <p className="eyebrow shopping-window-eyebrow">Vorratskammer</p>
              <h2 id="pantry-title">Vorhandene Zutaten</h2>
            </div>
            <span>{pantryItems.length} Zutaten vorhanden</span>
          </div>

          <form className="manual-item-form" onSubmit={addPantryItem}>
            <input value={pantryDraft.name} onChange={(event) => setPantryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Zutat" aria-label="Zutat" required />
            <input value={pantryDraft.quantity} onChange={(event) => setPantryDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="0" step="any" placeholder="Menge" aria-label="Menge" required />
            <input value={pantryDraft.unit} onChange={(event) => setPantryDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="Einheit" aria-label="Einheit" />
            <button type="submit">Zutat hinzufügen</button>
          </form>

          <div className="shopping-list" aria-label="Vorratskammer">
            {pantryItems.length === 0 ? (
              <p className="shopping-empty">Noch keine Zutaten in der Vorratskammer.</p>
            ) : (
              pantryItems.map((item) => (
                <div className="shopping-item" key={item.id}>
                  {editingPantryId === item.id && editingPantry ? (
                    <form className="pantry-edit-form" onSubmit={saveEditedPantry}>
                      <label>
                        Zutat
                        <input value={editingPantry.name} onChange={(event) => setEditingPantry((current) => current ? { ...current, name: event.target.value } : current)} required />
                      </label>
                      <label>
                        Menge
                        <input type="number" min="0" step="any" value={editingPantry.quantity} onChange={(event) => setEditingPantry((current) => current ? { ...current, quantity: Number(event.target.value) } : current)} required />
                      </label>
                      <label>
                        Einheit
                        <input value={editingPantry.unit} onChange={(event) => setEditingPantry((current) => current ? { ...current, unit: event.target.value } : current)} placeholder="Stück, Packung ..." />
                      </label>
                      <div className="recipe-actions">
                        <button type="submit">Speichern</button>
                        <button type="button" className="button-secondary" onClick={cancelEditingPantry}>Abbrechen</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="shopping-item-main">{item.name}</span>
                      <span className="shopping-item-meta">{item.quantity} {item.unit}</span>
                      <div className="shopping-item-actions">
                        <button type="button" onClick={() => startEditingPantry(item)} aria-label={`${item.name} bearbeiten`}>Bearbeiten</button>
                        <button type="button" className="button-danger" onClick={() => removePantryItem(item)} aria-label={`${item.name} aus der Vorratskammer löschen`}>Löschen</button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

    </main>
  );
}

export default App;
