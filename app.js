var AppRouter = Backbone.Router.extend({
	routes: {
		"": "list",
		"menu-items/new": "itemForm",
		"menu-items/:item": "itemDetails"
	},
	
	intialize: function() {
		//this.douche = new Douche();
		this.menuItems = new MenuItems();

		this.menuItemModel = new MenuItem(); //this.doucheModel = new DoucheMinion();
		//this.doucheView = new DoucheMinionDetails({ model: this.doucheModel });
		this.menuItemView = new MenuItemDetails({ model: this.menuItemModel });
		
		//this.kissMyCode = new KissMyCode({ collection: this.douche }); //menuView
        	this.menuView = new MenuView({ collection: this.menuItems });
        	this.menuItemForm = new MenuItemForm({ model: this.menuItem });
	},

	list: function() {
		$('#stayTFOffMyGit').html(this.kissMyCode.render().el); //menuView
	},

	itemDetails: function(item) {
        this.menuItemView.model = this.menuItems.get(items);
		// this.doucheView.model = this.doucheModel.get(items); //menuItemModel 
		$('#stayTFOffMyGit').html(this.doucheView.render().el);
	},

	itemForm: function() {
		$('#stayTFOffMyGit').html(this.menuItemForm.render().el);
	}
});

var app = new AppRouter();

$(function() {
	Backbone.history.start();
});
