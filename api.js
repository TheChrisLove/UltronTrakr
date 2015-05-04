var amp = require('amp.js');

module.exports = amp.AppController.extend({
	_models: ['Account'],

	render: function (data) {
		if (typeof data !== 'object') {
			return this._super.render.apply(this, arguments);
		}

		this._layout = false;

		this._set('data', data);
		this.render('/layouts/json');
	},

	user: function (id) {
		var _this	= this,
			where	= {id: _this.Session.get('User.id')};

		if (id && parseInt(id) !== where.id) {
			where.parent_id	= where.id;
			where.id		= id;
		}

		_this.Account.find({
			attributes: [
				'id', 'first_name', 'last_name', 'profile_image', 'email',
				'mobile_phone', 'language', 'gender', 'country_id', 'affiliate'
			],
			where: where
		}).success(function (user) {
			if (!user) {
				return _this.render(404);
			}

			user = user.dataValues;

			_this._getPicture(user, function (image) {
				user.picture = image;
			});

			_this.render(user);
		});
	},

	referrals: function () {
		var _this = this;

		this._referralStatus(_this.Session.get('User.id'), function (data) {
			_this.render(data);
		});
	}
});
