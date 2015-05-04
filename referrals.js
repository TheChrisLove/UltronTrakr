var amp				= require('amp.js'),
	async			= require('async'),
	MailChecker		= require('mailchecker'),
	L10n			= require('l10n'),
	locale			= new L10n(),
	phone_regexp	= /^(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})$/,
	blockAreaCodes	= /^(2(42|46|64|68|84))|340|345|441|473|(6(49|64|70|71|84))|(7(21|58|67|84))|(8(09|29|49|68|69|76))|939/;

module.exports = amp.AppController.extend({
	_components: ['Session', 'Emails', 'Plivo'],

	_common: function (cb) {
		this.Session.get('User', function (err, result) {
			if (err || !result) {
				this.redirect('/account/login');
			} else {
				this._super._common.call(this, cb);
			}
		}.bind(this));
	},

	invite: function () {
		var data, allowed, limit, imported, body, fn, videos,
			_this	= this,
			emails	= [],
			phones	= [],
			entries	= [];

		if (this.request.method === 'POST' && this.request.data && this.request.data.Referral) {
			fn			= function () {},
			imported	= this.Session.get('User.import_count') || 0;
			data		= this.request.data.Referral;
			body		= data.body
			allowed		= ['account_id', 'first_name', 'last_name', 'email', 'phone_number', 'body', 'status', 'created', 'modified'];

			delete data.body;

			if (data.imported && imported > this.configs.import_limit) {
				return this.render(403);
			}

			this._getCache('Referral:list:optouts', ['email', 'email'], function (err, optouts) {
				if (err && !optouts) {
					optouts = {};
				}

				async.eachLimit(Object.keys(data), 10, function (i, callback) {
					var entry = amp.extend({
						first_name: '',
						last_name: '',
						email: '',
						body: body,
						country_code: '+1'
					}, data[i], {
						phone_number: (data[i].phone_number || '').replace(/[^0-9]/g, ''),
						account_id: _this.Session.get('User.id'),
						status: 'pending',
						created: new Date,
						modified: new Date
					});

					if (data.imported) {
						if (imported > _this.configs.import_limit) {
							return callback();
						} else if (!entry.active) {
							return callback();
						}
					}

					entry.email			= _this.check_email(entry.email);
					entry.phone_number	= _this.check_phone(entry.phone_number);

					if (!entry.first_name && (entry.email || entry.phone_number)) {
						_this.Session.flash('We were not able to send an invite to at least one of your contacts. First name is required.');
						return callback();
					}

					if ((entry.email && emails.indexOf(entry.email) < 0) || (entry.phone_number && phones.indexOf(entry.phone_number) < 0)) {
						if (entry.email) {
							emails.push(entry.email);
						}

						if (entry.phone_number) {
							phones.push(entry.phone_number);
						}

						_this.Account.count({
							where: [
								'((email != "" AND email = ?) OR (mobile_phone != "" AND mobile_phone = ?)) AND deleted = 0',
								entry.email || '', entry.phone_number || ''
							],
							limit: 1
						}).success(function (user) {
							if (user) {
								entry.status = 'unavailable';
								entries.push(entry);
								return callback();
							} else if (entry.email && entry.email in optouts) {
								entry.status = 'optout';
								entries.push(entry);
								_this.Session.flash('At least one of your recipients has chosen to optout of our emails.');
								return callback();
							} else if (data.imported && ++imported > _this.configs.import_limit) {
								_this.Session.flash('You have reached your import limit. Please use the manual invitations for more invitations.');
								return callback();
							}

							entries.push(entry);

							if (_this.permissions && _this.permissions.invite_send === 0) {
								_this.Session.flash('Due to high amounts of spam and bounces sent from your account with NEURS, your emails and text messages have been blocked. The users you invite can still accept their invitations, yet you would need to notify them directly yourself.');
								return callback();
							}

							if (entry.email) {
								_this.Emails.set('user', _this.Session.get('User'));
								_this.Emails.set('comment', entry.body);
								_this.Emails.set('entry', entry);
	
								_this.Emails.send({
									to: entry.email,
									replyTo: _this.Session.get('User.email'),
									subject: ['Private invitation for %1$s by %2$s', entry.first_name, _this.Session.get('User.first_name') + ' ' + _this.Session.get('User.last_name')],
									layout: 'email',
									template: _this.configs['countries_activated'] > 0 ? 'invitation_generic' : 'invitation',
									language: entry.action
								}, fn);
							} else if (entry.phone_number) {
								_this.Plivo.send_message({
									src: '18188690993',
									dst: entry.country_code + entry.phone_number.replace(/[^\d]/g, ''),
									text: 'Hey %1$s, it\'s me %2$s. I just sent you an invitation to something extremely cool. Check it out @ neurs.com & accept my invitation'.format(entry.first_name, _this.Session.get('User.first_name')),
									url: 'http://' + _this.domain.full + '/plivo/message_status'
								});
							}

							callback();
						});
					} else {
						callback();
					}
				}, function () {
					if (entries.length) {
						_this.Referral.bulkCreate(entries, {fields: allowed}).success(function () {
							if (data.imported) {
								_this.Account.update({import_count: imported}, {id: _this.Session.get('User.id')}).success(function () {
									_this.Session.set('User.import_count', imported, function () {
										_this.redirect('/referrals/invite');
									});
								});
							} else {
								_this.redirect('/referrals/invite');
							}
						});
					} else {
						_this.redirect('/referrals/invite');
					}
				});
			});
		} else {
			this._import('Component', 'Contacts');

			if (this.Session.get('User.membership_plan_id') < 0) {
				this._set('autoplay', true);

				this.Account.update({membership_plan_id: 0}, {id: this.Session.get('User.id')}).success(function () {
					_this.Session.set('User.membership_plan_id', 0);
				});
			}

			this._referralStatus(this.Session.get('User.id'), function (statuses) {
				_this._set(statuses);
				_this._import('Model', 'Country');

				_this.Country.list(['id', 'country_code', 'name'], {where: 'country_code IS NOT NULL'}).success(function (countries) {
					_this._set('countries', countries);

					switch (_this.request.query.state) {
						case 'fetch':
							var data = _this.Session.get('Contacts');

							_this._layout = false;

							if (data) {
								_this.Session.del('Contacts');

								_this._set('data', data);
								_this.render('/layouts/json');
							} else {
								_this._set('data', []);
								_this.render(404, '/layouts/json');
							}
						break;

						case 'gmail':
							_this.Contacts.load('gmail').retrieve(0, function (data) {
								setTimeout(function () {
									_this.Session.del('Contacts');
								}, 1000 * 30); // 30 seconds;

								_this.Session.set('Contacts', data);

								_this.render('imported');
							});
						break;

						case 'live':
							_this.Contacts.load('live').retrieve('referrals/invite', function (data) {
								setTimeout(function () {
									_this.Session.del('Contacts');
								}, 1000 * 30); // 30 seconds;

								_this.Session.set('Contacts', data);

								_this.render('imported');
							});
						break;

						case 'yahoo':
							_this.Contacts.load('yahoo').retrieve(function (data) {
								setTimeout(function () {
									_this.Session.del('Contacts');
								}, 1000 * 30); // 30 seconds;

								_this.Session.set('Contacts', data);

								_this.render('imported');
							});
						break;

						default:
							_this.Contacts.load('yahoo').redirect(false, function (redirect) {
								_this._set('gmail_link', _this.Contacts.load('gmail').redirect(0));
								_this._set('live_link', _this.Contacts.load('live').redirect('referrals/invite'));
								_this._set('yahoo_link', redirect);

								_this.render();
							});
						break;
					}
				});
			});

			videos = {
				ita: '87186733',
				es_es: '87186736',
				spa: '87186734',
				por: '87493462',
				deu: '88716969',
				dut: '88716968',
				bul: '88716970'
			};

			this._set('video_url', videos[this.request.language] || '87187341');
		}

		this._set('import_limit', this.configs.import_limit);
	},

	check_email: function (email) {
		email = (email || '').trim();

		if (!email || !MailChecker(email)) {
			return false;
		} else if (/@(facebook|facebookmail).(com)$/.test(email)) {
			return false;
		} else if (/^(info|sales|help|support|do-not-reply|no-reply|contact)@/.test(email)) {
			return false;
		}

		return email;
	},

	check_phone: function (phone) {
		phone = phone_regexp.test(phone) && phone.replace(/[^\d]/g, '');

		if (!phone || phone.length !== 10 || blockAreaCodes.test(phone)) {
			return '';
		}

		return phone;
	},

	invite_actions: function (action, id) {
		var _this = this;

		switch (action) {
			case 'resend':
				this.Referral.find({
					attributes: ['first_name', 'email', 'phone_number', 'body', 'created', 'modified'],
					where: {
						id: id,
						account_id: this.Session.get('User.id'),
						status: ['pending', 'expired', 'read'],
					}
				}).success(function (referral) {
					if (!referral) {
						_this.redirect('/referrals/invite');
						return;
					}

					var invite = referral.dataValues;

					if (invite.created.getTime() === invite.modified.getTime() || invite.modified.getTime() < ((new Date).getTime() - 1000 * 60 * 60 * 24)) {
						if (invite.email) {
							_this.Emails.set('user', _this.Session.get('User'));
							//_this.Emails.set('comment', invite.body);
							_this.Emails.set('entry', invite);

							_this.Emails.send({
								to: invite.email,
								replyTo: _this.Session.get('User.email'),
								subject: ['Private invitation for %1$s by %2$s', invite.first_name || '', _this.Session.get('User.first_name') || ''],
								layout: 'email',
								template: 'invitation'
							});
						} else if (invite.phone_number) {
							_this.Plivo.send_message({
								src: '18188690993',
								dst: invite.phone_number,
								text: 'Hey %1$s, it\'s me %2$s. I just sent you an invitation to something extremely cool. Check it out @ neurs.com & accept my invitation'.format(invite.first_name, _this.Session.get('User.first_name')),
								url: 'http://' + _this.domain.full + '/plivo/message_status'
							});
						}
					}

					referral.updateAttributes({status: 'pending', modified: new Date}).success(function () {
						_this.redirect('/referrals/invite');
					});
				});
			break;

			case 'delete': 
				this.Referral.update({
					deleted: 1,
					deleted_date: new Date
				}, {
					id: id,
					account_id: this.Session.get('User.id'),
					status: ['pending', 'expired', 'unavailable', 'optout', 'bounced', 'read']
				}).success(function (referral) {
					_this.redirect('/referrals/invite');
				});
			break;

			default:
				this.redirect('/referrals/invite');
			break;
		}
	},

	insight: function (user) {
		var _this = this;

		if (!user) {
			return this.redirect('/referrals/invite');
		}

		this._import('Model', 'Location');

		this.Account.find({
			attributes: ['id', 'parent_id', 'first_name', 'last_name', 'email', 'mobile_phone', 'profile_image', 'language', 'gender', 'country_id'],
			where: {id: user}
		}).success(function (user) {
			var current = _this.Session.get('User.id');

			if (!user || (user.id !== current && user.parent_id !== current)) {
				return _this.render(403);
			}

			_this._getCache('Location:list:countries', ['id', 'name'], function (err, countries) {
				_this._referralStatus(user.id, function (data) {
					_this._getPicture(user, function (image) {
						_this._set('referrals', data);
						_this._set('picture', image);
						_this._set('downline', user.dataValues);
						_this._set('country', countries[user.country_id]);
						_this.render();
					});
				});
			});
		});
	},

	insight_levels: function (user) {
		var _this = this;

		if (!user) {
			return this.redirect('/referrals/invite');
		}

		this.Account.find({
			attributes: ['id', 'parent_id'],
			where: {id: user}
		}).success(function (user) {
			var query	= '',
				current	= _this.Session.get('User.id');

			if (!user || (user.id !== current && user.parent_id !== current)) {
				return _this.render(403);
			}

			query += 'SELECT level, count ';
			query += 'FROM reach_counts ';
			query += 'WHERE account_id = ' + user.id;
			query += '	AND type = "total";';

			amp.db.query(query).success(function (counts) {
				var levels, total, max;

				_this._layout = false;

				if (!counts || !counts.length) {
					_this._set('data', {
						level: 'Total Users',
						count: 0
					});

					return _this.render('/layouts/json');
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

				_this._set('data', levels);
				_this.render('/layouts/json');
			});
		});
	},

	reach: function () {
		var _this = this;

		if (this.permissions.affiliate === 3) {
			this._set('compensation', true);
		}

		this._referralStatus(this.Session.get('User.id'), function (statuses) {
			_this._set(statuses);
			_this.render();
		});
	},

	mapData: function () {
		var _this	= this,
			data	= {client: {}};

		this._layout = false;

		this._clientInfo(function (err, info) {
			if (err) {
				throw err;
			}

			if (info) {
				data.client = info;
			}

			async.parallel({
				levels: function (callback) {
					_this._mapLevels(callback);
				},
				markers: function (callback) {
					_this._mapDataMarkers(callback);
				},
				compensation: function (callback) {
					_this._mapCompensation(callback);
				}
			}, function (err, results) {
				if (!err) {
					data.levels			= results.levels;
					data.countries		= results.markers;
					data.compensation	= results.compensation;
				}

				_this._set('data', data);
				_this.render('/layouts/json');
				_this.Session.del('reach_loading');
			});
		});
	},

	_mapLevels: function (callback) {
		var _this	= this,
			query	= '';

		query += 'SELECT level, count ';
		query += 'FROM reach_counts ';
		query += 'WHERE account_id = ' + this.Session.get('User.id');
		query += '	AND type = "total";';

		amp.db.query(query).success(function (counts) {
			var levels, total, max;

			if (!counts || !counts.length) {
				return callback(null, [0]);
			}

			total	= 0,
			max		= counts[counts.length - 1].level;
			levels	= Array.apply(null, new Array(max + 1)).map(function () {
				return 0;
			});

			counts.forEach(function (count) {
				var level = parseInt(count.level),
					count = parseInt(count.count);

				levels[0]		+= count;
				levels[level]	= count;
			});

			callback(null, levels);
		});
	},

	_mapDataMarkers: function (callback) {
		var _this	= this,
			query	= '';

		query += 'SELECT SUM(count) AS count, locations.iso, locations.name ';
		query += 'FROM reach_counts ';
		query += 'LEFT JOIN locations ON (locations.id = reference) ';
		query += 'WHERE account_id = ' + this.Session.get('User.id');
		query += '	AND type = "country"';
		query += 'GROUP BY reference;';

		amp.db.query(query).success(function (counts) {
			var countries = [];

			if (!counts || !counts.length) {
				return callback(null, []);
			}

			counts.forEach(function (count) {
				if (count.iso) {
					countries.push({
						count: count.count,
						iso: count.iso,
						name: count.name
					});
				}
			});

			callback(null, countries);
		});
	},

	_mapCompensation: function (callback) {
		var _this = this;

		callback(null, [
			75, 10, 9, 8, 7, 6, 4, 2, 1, .5, .25,
			.10, .10, .10, .10, .10, .10, .10, .10, .10, .10,
			.10, .10, .10, .10, .10, .10, .10, .10, .10, .10
		]);
	}
});

/*counts = [
	{
		count: 232,
		id: Math.random(),
		iso: 'US',
		name: 'United States',
		code: null
	}, {
		count: 156,
		id: Math.random(),
		iso: 'CA',
		name: 'Canada',
		code: null
	}, {
		count: 18,
		id: Math.random(),
		iso: 'MX',
		name: 'Mexico',
		code: null
	}, {
		count: 28,
		id: Math.random(),
		iso: 'AR',
		name: 'Argentina',
		code: null
	}, {
		count: 58,
		id: Math.random(),
		iso: 'PR',
		name: 'Puerto Rico',
		code: null
	}, {
		count: 129,
		id: Math.random(),
		iso: 'GB',
		name: 'United Kingdom',
		code: null
	}, {
		count: 11,
		id: Math.random(),
		iso: 'PL',
		name: 'Poland',
		code: null
	}, {
		count: 86,
		id: Math.random(),
		iso: 'GL',
		name: 'Greenland',
		code: null
	}, {
		count: 1,
		id: Math.random(),
		iso: 'ES',
		name: 'Spain',
		code: null
	}, {
		count: 232,
		id: Math.random(),
		iso: 'EG',
		name: 'Egypt',
		code: null
	}, {
		count: 71,
		id: Math.random(),
		iso: 'AU',
		name: 'Australia',
		code: null
	}
];*/
