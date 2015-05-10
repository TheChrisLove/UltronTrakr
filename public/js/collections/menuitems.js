var MenuItems = Backbone.Collection.extend({
	comparator: 'name',
	model: MenuItem,
	url: '/items'
});