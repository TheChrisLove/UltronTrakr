var Douches = Backbone.Collection.extend({
	comparator: 'name',
	model: DoucheMinion,
	url: '/douches'
})
