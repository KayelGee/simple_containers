/**
 * Activate certain behaviors on FVTT ready hook
 */
Hooks.once("init", () => {
  // Pre-load templates
  loadTemplates([
    // Actor Sheet Partials
    "public/systems/simple_containers/templates/actor-sheet-container-items.html"
  ]);
});

/**
 * Extend the basic ActorSheet with some very simple modifications
 */
class SimpleActorSheet extends ActorSheet {

  /**
   * Extend and override the default options used by the 5e Actor Sheet
   */
	static get defaultOptions() {
	  const options = super.defaultOptions;
	  options.classes = options.classes.concat(["worldbuilding", "actor-sheet"]);
	  options.template = "public/systems/simple_containers/templates/actor-sheet.html";
    options.width = 800;
    options.height = 600;
	  return options;
  }

  /* -------------------------------------------- */

  /**
   * Activate event listeners using the prepared sheet HTML
   * @param html {HTML}   The prepared HTML object ready to be rendered into the DOM
   */
	activateListeners(html) {
    super.activateListeners(html);

    // Activate tabs
    let tabs = html.find('.tabs');
    let initial = this.actor.data.flags["_sheetTab"];
    new Tabs(tabs, {
      initial: initial,
      callback: clicked => this.actor.data.flags["_sheetTab"] = clicked.attr("data-tab")
    });

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;
		
    // Update Inventory Item
    html.find('.item-edit').click(ev => {
      let itemId = Number($(ev.currentTarget).parents(".item-row").attr("data-item-id"));
      let Item = CONFIG.Item.entityClass;
      const item = new Item(this.actor.items.find(i => i.id === itemId), this.actor);
      item.sheet.render(true);
    });

    // Delete Inventory Item
    html.find('.item-delete').click(ev => {
      let li = $(ev.currentTarget).parents(".item-row"),
        itemId = Number(li.attr("data-item-id"));
      this.actor.deleteOwnedItem(itemId, true);
      li.slideUp(200, () => this.render(false));
    });
		
		// Set Drag handler
		let handler = ev => this._onDragItemStart(ev);
			html.find('.item-row').each((i, li) => {
				li.addEventListener("dragstart", handler, false);
			});
  }
	
  /**
   * Handle the dragstart event
   */
  _onDragItemStart(event) {
    let itemId = Number(event.currentTarget.getAttribute("data-item-id"));
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Item",
      actorId: this.actor._id,
      id: itemId,
      root: Number(event.currentTarget.getAttribute("root"))
    }));
		//Prevent dragstart of parents
		event.stopPropagation();
  }
	
  /**
   * Handle the drop event
   */
  async _onDrop(event) {
		event.preventDefault();
		let dragData = event.dataTransfer.getData("text/plain");
		
		// Item dragged from sidebar onto actor
		if(!JSON.parse(dragData).hasOwnProperty('actorId')){
			super._onDrop(event);
			return;
		}
		
		let dropID = Number($(event.target).parents(".item-row").attr("data-item-id"));
	  let dragItem = (game.actors.get(JSON.parse(dragData).actorId)).getOwnedItem(JSON.parse(dragData).id);
	  let dropItem = this.actor.getOwnedItem(dropID);
	  
		//Item dragged from actor to actor
		//or Item dragged somewhere inside the actor which isn't a container
	  if(dragItem.actor != dropItem.actor
		|| isNaN(dropID)
		|| dropItem.data.type !== "container"){
			this.remove_item_from_container(dragItem);
			dragItem.data.data.parent.value = -1;
			await dragItem.actor.updateOwnedItem(dragItem.data, true); 
			super._onDrop(event);			 
			return;
		}
		
		// Drop onto itself
		if (dragItem.data.id == dropItem.data.id){
			return;
		}

		// Look for loops in parents
		let parent_container=dropItem;
		while(parent_container.data.data.parent.value !== -1){
			if(parent_container.data.data.parent.value === dragItem.data.id){
				throw "Inserting Item would generate loop";
			}
			parent_container = this.actor.getOwnedItem(parent_container.data.data.parent.value);
		}
		
		// Check for dimensional inserting into another as the universe breaks once you do(or a Rift to an Astral Plane opens)
		// Target container only has to check parents and itself
		let drop_dimensional = (dropItem.data.type === 'container' && dropItem.data.data.dimensional.value);
		parent_container=dropItem;
		while(parent_container.data.data.parent.value !== -1){
			parent_container = this.actor.getOwnedItem(parent_container.data.data.parent.value);
			drop_dimensional = drop_dimensional || ((parent_container.data.type === 'container' && parent_container.data.data.dimensional.value));
		}
		
		// Dragged container has to check children and itself
		let child_dimensional = function(element){
			let dimensional = (element.data.type === 'container' && element.data.data.dimensional.value);
			if(element.data.type === 'container'){
				for(let i of element.data.data.children){
					dimensional = dimensional || child_dimensional(element.actor.getOwnedItem(i));
				}
			}
			return dimensional;
		}		
		let drag_dimensional = child_dimensional(dragItem);
		
		// Send a chat message if two extradimensional containers were inserted into each other
		if(drag_dimensional && drop_dimensional){
			const chatData = {
				user: game.user._id,
				speaker: {
					actor: this.actor._id,
					token: this.actor.token,
					alias: this.actor.name
				}
			};
			chatData["content"] = "I put my " + dragItem.name + " into my " + dropItem.name + " knowing full well that this opens a rift into the astral plane";
			ChatMessage.create(chatData, {displaySheet: false}); 
		}
		
		// Remove from old container
		this.remove_item_from_container(dragItem);
		// Insert into new container
		dragItem.data.data.parent.value = dropID;
		dropItem.data.data.children.push(dragItem.data.id);
		await dragItem.actor.updateOwnedItem(dragItem.data, true);  
	}
	
	/**
   * removes dragged Item from it's previous container
   */
	async remove_item_from_container(dragItem){
		if(dragItem.data.data.parent.value === -1) return;
		
		let container = this.actor.getOwnedItem(dragItem.data.data.parent.value);
		let index = container.data.data.children.indexOf(dragItem.data.id);
		if(index !== -1){
			container.data.data.children.splice(index,1);
			await container.actor.updateOwnedItem(container.data, true);  
		}
	}
	
	/**
   * Add some extra data when rendering the sheet to reduce the amount of logic required within the template.
   */
  getData() {
    const sheetData = super.getData();
    this._prepareItems(sheetData.actor);
		
    sheetData.isToken = this.actor.token;
    sheetData.isGM = game.user.isGM; 
		
    // Return data to the sheet
    return sheetData;
  }
	
	/**
   * Organize and classify Items for Character sheets
   * @private
   */
  _prepareItems(actorData) {

    // Inventory
    const inventory = {
      weapon: { label: "Weapons", items: [] },
      equipment: { label: "Equipment", items: [] },
      consumable: { label: "Consumables", items: [] },
      tool: { label: "Tools", items: [] },
      container: { label: "Containers", items: [] },
    };
	
		//Items in Containers
		const contained = [];
		
    // Iterate through items, allocating to containers
    for ( let i of actorData.items ) {
      i.img = i.img || DEFAULT_TOKEN;

      // Inventory
      if ( Object.keys(inventory).includes(i.type) ) {
				if(i.data.parent.value !== -1){
					contained.push(i);
					if(i.type === 'container') {
						inventory[i.type].items.push(i);
					}
				}
				else{
					inventory[i.type].items.push(i);
				}
      }
    }
		
		// Assign contained items it their respective containers
		for(let i =0 ; i <contained.length; i++){	
			for(let j =0 ; j <inventory['container'].items.length; j++){
				if(inventory['container'].items[j].id === contained[i].data.parent.value){
					if(!inventory['container'].items[j].hasOwnProperty('items')) inventory['container'].items[j].items= [];
					inventory['container'].items[j].items.push(contained[i]);
				}
			}
		}
		
		// Remove contained containers from inventory
		for(let i =inventory['container'].items.length-1 ; i >=0; i--){
			if(inventory['container'].items[i].data.parent.value !== -1){
				inventory['container'].items.splice(i,1);
			}
		}
		
    // Assign and return
    actorData.inventory = inventory;
  }
}

Actors.unregisterSheet("core", ActorSheet);
Actors.registerSheet("core", SimpleActorSheet, {
  types: [],
  makeDefault: true
});


/* -------------------------------------------- */


/**
 * Extend the basic ItemSheet with some very simple modifications
 */
class SimpleItemSheet extends ItemSheet {

  /**
   * Extend and override the default options used by the 5e Actor Sheet
   */
	static get defaultOptions() {
	  const options = super.defaultOptions;
	  options.classes = options.classes.concat(["worldbuilding", "item-sheet"]);
	  options.template = "public/systems/simple_containers/templates/item-sheet.html";
	  options.height = 400;
	  return options;
  }
  /**
   * Activate listeners for interactive item sheet events
   */
  activateListeners(html) {
    super.activateListeners(html);
	  html.find(".item-checkbox").click(async event => {
		  this._onSubmit(event);
		  let target = $(event.currentTarget).attr("data-target");
		  let path = target.split(".");
		  this.item.update({[`data.${target}`] : !this.item.data.data[path[0]][path[1]]})
		})
  }
}

CONFIG.Item.sheetClass = SimpleItemSheet;


/* -------------------------------------------- */
