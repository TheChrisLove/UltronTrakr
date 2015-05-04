var amp		= require('amp.js'),
	async	= require('async');

module.exports = amp.AppController.extend({
	_models: ['Referral'],

	_common: function (cb) {
		this._super._common.call(this, function () {
			var _this	= this,
				ret 	= false;

			if ([1, '1', 5, '5'].indexOf(this.Session.get('User.membership_plan_id')) >= 0) {
				ret = true;
			}

			if (!ret && this.permissions['admin']) {
				if (this.permissions[this.request.route.action]) {
					ret = true;
				} else if (this.permissions['super_admin']) {
					ret = true;
				}
			}

			if (ret) {
				this._getCache('Config:list', ['name', 'value'], function (err, configs) {
					// Lets get the latest configs, sans caching
					_this.configs = configs;
					cb();
				}, true);
			} else {
				this.render(404);
			}
		}.bind(this));
	},

	index: function () {
		var data,
			_this = this;

		this._set('configs', this.configs);

		if (this.request.method === 'POST') {
			data = this.request.data.Config;

			async.eachLimit(Object.keys(data), 20, function (key, cb) {
				if (data[key] === _this.configs[key]) {
					cb();
					return;
				}

				_this.Config.update({value: data[key]}, {name: key}).success(function () {
					_this.configs[key] = data[key];

					cb();
				}).error(cb);
			}, function (err) {
				_this.render();
			});
		} else {
			this.render();
		}
	},

	user: function (id) {
		var _this = this;

		if (!id) {
			this.render(404);
			return;
		}

		if (id === this.Session.get('User.id')) {
			this._set('data', this.Session.get('User'));
			this.render();
			return;
		}

		this.Account.find({
			attributes: ['id', 'first_name', 'last_name'],
			where: {id: parseInt(id)}
		}).success(function (user) {
			if (!user) {
				_this.render(404);
				return;
			}

			_this._set('data', user);
			_this.render();
		});
	},

	users: function () {
		var _this	= this,
			data	= this.request.data;

		if (this.request.method !== 'POST' || !data || !(data.Search.query || '').trim()) {
			return this.render();
		}

		data = data.Search.query.trim();

		this.Account.findAll({
			where: [
				'CONCAT(first_name," ",last_name) LIKE ? OR CONCAT(first_name," ",middle_name," ",last_name) LIKE ? OR email LIKE ?',
				data, data, data
			]
		}).success(function (results) {
			_this._set('results', results);
			_this.render();
		});
	},

	data: function (name) {
		var date,
			_this = this;

		name			= '_' + name;
		this._layout	= false;

		if (this.request.query.time) {
			date = new Date;

			date.setDate(date.getDate() - parseInt(this.request.query.time));

			this.request.query.time	= date;
		}

		if (name in this) {
			this[name](function (data) {
				if (data) {
					_this._set('data', data);
					_this.render('/layouts/json');
				} else {
					_this._set('data', {error: 'Analytic Source Error'});
					_this.render('/layouts/json');
				}
			});
		} else {
			this._set('data', {error: 'Invalid Analytic Source'});
			this.render('/layouts/json');
		}
	},

	_user: function (callback) {
		var _this	= this,
			params	= this.request.query;

		if (!params.id) {
			callback();
			return;
		}

		this.Account.find(params.id).success(function (user) {
			if (!user) {
				callback();
				return;
			}

			callback(user.dataValues);
		});
	},

	_user_levels: function (callback) {
		var query	= '',
			params	= this.request.query;

		if (!params.id) {
			return callback();
		}

		query += 'SELECT level, count ';
		query += 'FROM reach_counts ';
		query += 'WHERE account_id = ' + params.id;
		query += '	AND type = "total";';

		amp.db.query(query).success(function (counts) {
			var levels, total, max;

			if (!counts || !counts.length) {
				return callback({
					level: 'Total Users',
					count: 0
				});
			}

			total	= 0,
			max		= counts[counts.length - 1].level;
			levels	= Array.apply(null, new Array(max + 1)).map(function (_, i) {
				if (i === 0) {
					return {
						level: 'Total Users',
						count: 0
					};
				}

				return {
					level: 'Level ' + i,
					count: 0
				};
			});

			counts.forEach(function (count) {
				var level = parseInt(count.level),
					count = parseInt(count.count);

				levels[0].count	+= count;
				levels[level]	= {
					level: 'Level ' + level,
					count: count
				};
			});

			callback(levels);
		});
	},

	_user_referrals: function (callback) {
		var params = this.request.query;

		if (!params.id) {
			return callback();
		}

		this._referralStatus(params.id, callback);
	},

	_user_downlines: function (callback) {
		var _this	= this,
			params	= this.request.query;

		if (!params.id) {
			return callback();
		}

		this.Account.findAll({
			attributes: [
				'id', 'first_name', 'last_name', 'gender', 'email',
				'mobile_phone', 'profile_image', 'deleted'
			],
			where: {parent_id: params.id}
		}).success(function (users) {
			var i,
				data = [];

			if (!users) {
				callback();
				return;
			}

			for (i in users) {
				_this._getPicture(users[i].dataValues, function (image) {
					users[this].dataValues.picture = image;
				}.bind(i));

				data.push(users[i].dataValues);
			}

			callback(data);
		});
	},

	_downline_counts: function (callback) {
		var _this	= this,
			query	= '',
			offset	= this.request.query.page - 1 || 0,
			limit	= !isNaN(this.request.query.limit) ? (this.request.query.limit > 100 ? 100 : this.request.query.limit) : 50;

		query += 'SELECT a1.id, a1.first_name, a1.last_name, a1.profile_image, COUNT(a2.id) as `count`';
		query += ' FROM `accounts` AS a1';
		query += ' LEFT JOIN  `accounts` AS a2 ON (a1.id = a2.parent_id)';
		query += ' WHERE a2.deleted = 0';

		if (this.request.query.time) {
			query += '  AND a2.created > ' + amp.db.Utils.format(['?', this.request.query.time]);
		}

		query += ' GROUP BY a1.id, a1.first_name, a1.last_name, a1.profile_image';
		query += ' HAVING COUNT(a2.id) >= ' + (parseInt(this.request.query.count) || 0);
		query += ' ORDER BY `count` DESC';
		query += ' LIMIT ' + (offset * limit) + ', ' + limit;

		amp.db.query(query).success(function (users) {
			var data = [];

			if (!users) {
				return callback(data);
			}

			users.forEach(function (user) {
				_this._getPicture(user, function (image) {
					user.picture = image;
				});

				data.push(user);
			});

			data.sort(function (a, b) {
				if (a.count === b.count) {
					return b.id - a.id;
				}

				return b.count - a.count;
			});

			callback(data);
		});
	},

	_invitations: function (callback) {
		var _this	= this,
			query	= '',
			offset	= this.request.query.page - 1 || 0,
			limit	= !isNaN(this.request.query.limit) ? (this.request.query.limit > 100 ? 100 : this.request.query.limit) : 50;

		query += 'SELECT `account_id`, COUNT(account_id) as `count`';
		query += ' FROM `referrals`';
		query += ' WHERE status IN (\'' + this.request.query.status.split('|').join('\', \'') + '\')';

		if (this.request.query.time) {
			query += ' AND created > ' + amp.db.Utils.format(['?', this.request.query.time]);
		}

		query += ' GROUP BY `account_id`';
		query += ' HAVING COUNT(account_id) >= ' + (parseInt(this.request.query.count) || 0);
		query += ' ORDER BY `count` DESC';
		query += ' LIMIT ' + (offset * limit) + ', ' + limit;

		amp.db.query(query).success(function (referrals) {
			var i,
				_users = {};

			for (i in referrals) {
				_users[referrals[i].account_id] = referrals[i].count;
			}

			_this.Account.findAll({attributes: ['id', 'first_name', 'last_name'], where: {id: Object.keys(_users)}}).success(function (users) {
				var data = [];

				async.eachLimit(users, 20, function (user, cb) {
					var values = user.dataValues;

					values.count = _users[user.dataValues.id];

					_this._getPicture(user.dataValues, function (image) {
						values.picture = image;

						data.push(values);

						cb();
					});
				}, function () {
					data.sort(function (a, b) {
						if (a.count === b.count) {
							return b.id - a.id;
						}

						return b.count - a.count;
					});

					callback(data);
				});
			});
		});
	},

	_top_affiliate_upgrades: function (callback) {
		var _this	= this,
			query	= '',
			offset	= this.request.query.page - 1 || 0,
			limit	= !isNaN(this.request.query.limit) ? (this.request.query.limit > 100 ? 100 : this.request.query.limit) : 50;;

		query += 'SELECT COUNT(parent.id) AS count, parent.id, parent.first_name, parent.last_name, parent.profile_image';
		query += '	FROM account_permissions AS child_perms';
		query += '	LEFT JOIN accounts AS child ON (child.id = child_perms.account_id)';
		query += '	LEFT JOIN accounts AS parent ON (parent.id = child.parent_id)';
		query += '	LEFT JOIN account_permissions AS parent_perms ON (parent_perms.account_id = parent.id)';
		query += '	WHERE child_perms.action = "affiliate"';
		query += '		AND child_perms.allowed > 1';
		query += '		AND child_perms.deleted = 0';
		query += '		AND child.deleted = 0';
		query += '		AND parent.deleted = 0';
		query += '		AND parent_perms.action = "affiliate"';
		query += '		AND parent_perms.allowed > 1';
		query += '		AND parent_perms.deleted = 0';
		query += '	GROUP BY parent.id';
		query += '	ORDER BY count DESC, parent.id ASC';
		query += '	LIMIT ' + (offset * limit) + ', ' + limit;

		amp.db.query(query).success(function (affiliates) {
			var i;

			for (i in affiliates) {
				_this._getPicture(affiliates[i], function (image) {
					affiliates[i].picture = image;
				});
			}

			callback(affiliates);
		});
	},

	_upgrade_log: function(callback) {
        	var query = '',
			offset 	= this.request.query.page -1 || 0,
			limit 	=!isNaN(this.request.query.limit) ? (this.request.query.limit > 100 ? 100 : this.request.query.limit) : 50;;			

		query += 'SELECT child.id, child.first_name, child.last_name, parent.id, parent.first_name, parent.last_name, countries.name, ap.action, child.created';
		query += '	FROM accounts AS child';
		query += '	LEFT JOIN accounts AS parent ON (parent.id = child.parent_id)';
		query += '	LEFT JOIN countries ON (countries.id = child.country_id)';
		query += '	LEFT JOIN account_permissions AS ap ON (ap.account_id = child.id)'
		query += '	WHERE child.deleted = 0';
		query += '		AND parent.deleted = 0';
		query += '		AND ap.action = "affiliate"';
		query += '		AND ap.allowed > 0';
		query += '		AND child.active > 0';
		query += '	ORDER BY child.created DESC';
		query += '	LIMIT ' + (offset * limit) + ', ' + limit;		

		amp.db.query(query).success(function (upgrades) {
			callback(upgrades);
        	}).error(function (err) {
			console.log('Error:', err);
		});
	},

	_browsers: function (callback) {
		callback();
	}
});
