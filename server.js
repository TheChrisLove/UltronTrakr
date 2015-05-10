var express = require('express'),
	http = require('http'),
	items = require('./data/menu-items');
	
var app = express()
	.use(express.bodyParser())
	.use(express.static('public'));

app.get('/', function(req, res) {
	res.render('index.hbs', {data: JSON.stringify(items)});
});

app.get('/items', function(req, res) {
	res.json(items);
});

app.post('/items', function(req, res) {
	var matches = items.filter(function(item) {
		return item.url == req.body.url;
	});
	
	if(matches.length > 0) {
		res.json(409, {status: 'Oops! Douche already exists.'});
	} else {
		req.body.id = req.body.url;
		items.push(req.body);
		res.json(req.body);
	}
});

app.listen(3000);
console.log('\nListening on port 3000');

