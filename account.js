var amp			= require('amp.js'),
	fs			= require('fs'),
	gm			= require('gm').subClass({imageMagick: true}),
	crypto		= require('crypto'),
	async		= require('async'),
	braintree	= require('braintree'),
	MailChecker	= require('mailchecker'),
	L10n		= require('l10n'),
	locale		= new L10n,
	knox		= amp.config.env !== 'development' && require('knox').createClient(amp.config.knox),
	gateway		= braintree.connect({
		environment: braintree.Environment[amp.config.braintree.environment],
		merchantId: amp.config.braintree.merchantId,
		publicKey: amp.config.braintree.publicKey,
		privateKey: amp.config.braintree.privateKey
	});

module.exports = amp.AppController.extend({
	_components: ['Session'],
	_models: ['Account', 'Referral'],

	_password: function (password) {
		return crypto
			.createHash('sha1')
			.update(amp.config.security.salt + password)
			.digest('hex');
	},

	optout: function () {
		var _this = this;

		if (this.request.method !== 'POST' || !this.request.data) {
			return this.render();
		}

		this.Account.count({
			where: {
				email: this.request.data.Account.email,
				deleted: 0
			}
		}).success(function (user) {
			if (user) {
				_this.Session.flash('It seems like this email is registered through an account. If you would like to optout, please log into your account and go to Settings to manage your notification settings. You may also optout by deleting your account in the Settings page.');
				return _this.render();
			}

			_this._import('Model', 'Referral');

			_this.Referral.update({status: 'optout'}, {email: _this.request.data.Account.email}).success(function () {
				_this.Session.flash('You have been opted out of our email system. If you would to opt back in or would like to receive an invitation in the future, please <a href="/pages/contact">contact support via the website</a> or <a href="mailto:info@neurs.com">email us</a>.');
				_this.render();
			});
		});
	},

	login: function () {
		var password,
			_this = this;

		this.Session.get('User', function (err, result) {
			if (result) {
				if (_this.request.url === '/account/login.json') {
					return _this.redirect('/api/user');
				}

				switch (parseInt(result.membership_plan_id)) {
					case -1:
					case 0:
						return _this.redirect('/referrals/invite');
					default:
						if (result.active > 0) {
							return _this.redirect('https://my.' + _this.domain.domain + '/login');
						}

						_this.Session.set('Upgrade', true, function () {
							_this.redirect('/account/upgrade_info');
						});
				}
			} else if (_this.request.method === 'POST' && _this.request.data) {
				password = _this._password(_this.request.data.Account.password);

				_this.Account.find({where: {email: _this.request.data.Account.email, password: password, deleted: 0}}).success(function (account) {
					if (!account) {
						if (_this.request.url === '/account/login.json') {
							return _this.render(401);
						}

						_this.Session.flash('Invalid credentials');
						_this.render();
					} else {
						_this.Session.set('User', account.dataValues, function () {
							if (_this.request.url === '/account/login.json') {
								return _this.redirect('/api/user');
							}

							switch (parseInt(account.membership_plan_id)) {
								case -1:
								case 0:
									return _this.redirect('/referrals/invite');
								default:
									if (account.active > 0) {
										return _this.redirect('https://my.' + _this.domain.domain + '/login');
									}

									_this.Session.set('Upgrade', true, function () {
										_this.redirect('/account/upgrade_info');
									});
							}
						});
					}
				}).error(function (error) {
					if (_this.request.url === '/account/login.json') {
						return _this.render(401);
					}

					_this.Session.flash('An error occurred. Please try again.');
					_this.render();
				});
			} else {
				if (_this.request.url === '/account/login.json') {
					return _this.render(400);
				}

				_this.render();
			}
		});
	},

	logout: function () {
		this.Session.destroy(function () {
			this.redirect('/account/login');
		}.bind(this));
	},

	picture: function (id) {
		this._getPicture(id, function (picture) {
			this.redirect(picture);
		}.bind(this));
	},

	settings: function () {
		var _this	= this,
			allowed	= [
				'first_name', 'last_name', 'email', 'mobile_phone', 'state',
				'country_id', 'gender', 'language', 'affiliate', 'profile_image'
			],
			find = amp.extend([], allowed);

		if (!this.Session.get('User.id')) {
			this.redirect('/account/login');
			return;
		}

		find.push('id', 'active');

		this._import('Model', 'Notification');

		this.Account.find({
			attributes: find,
			where: {id: parseInt(_this.Session.get('User.id'))}
		}).success(function (user) {
			var results, email, data,
				notification_types	= ['accepted_invite', 'broadcast', 'blog_post', 'new_country', 'new_level'];

			if (_this.request.method === 'POST' && _this.request.data) {
				data	= amp.extend({}, user.dataValues);
				email	= user.dataValues.email;

				if (_this.request.data.Account.email.trim() === '' || !MailChecker(_this.request.data.Account.email)) {
					_this.Session.flash('You must have a valid email address on file.');
					return _this.redirect('/account/settings');
				} else if (amp.config.L10n.supported.indexOf(_this.request.data.Account.language) === -1) {
					_this.Session.flash('Unsupported Language. Please choose one of the listed languages.');
					return _this.redirect('/account/settings');
				} else if (_this.request.data.Account.affiliate && !_this._validateAffiliate(_this.request.data.Account.affiliate, true)) {
					_this.Session.flash('There is an error with your affiliate page link. Please meet the requirements listed in the Affiliate tab.');
					return _this.redirect('/account/settings');
				}

				if (_this.request.data.Account.affiliate === '') {
					_this.request.data.Account.affiliate = null;
					delete _this.request.data.Account.affiliate;
				}

				user.updateAttributes(_this.request.data.Account, allowed).success(function () {
					var i, ext,
						picture			= _this.request.files && _this.request.files.Account.profile_picture,
						notifications	= {
							enable: [],
							disable: []
						};

					_this.Session.set('User', user.dataValues);

					_this._import('Component', 'Sendgrid');

					if (data.affiliate === '' && user.affiliate) {
						_this.Sendgrid.delete(user.language + ' - Not Affiliate', user.email);
						_this.Sendgrid.add(user.language + ' - Affiliate', user.email, user.first_name);
					}

					if (data.email !== user.email) {
						_this.Referral.update({
							email: user.email
						}, {
							email: data.email
						});

						_this.Sendgrid.lists(data.email, function (err, lists) {
							lists.forEach(function (list) {
								_this.Sendgrid.delete(list, data.email);
								_this.Sendgrid.add(list, user.email, user.first_name);
							});
						});
					}

					if (data.language !== user.language) {
						_this.Sendgrid.lists(data.email, function (err, lists) {
							lists.forEach(function (list) {
								var list2 = list.replace(data.language, user.language);
								_this.Sendgrid.delete(list, data.email);
								_this.Sendgrid.add(list2, user.email, user.first_name);
							});
						});
					}

					if (_this.request.data.Notification) {
						for (i in notification_types) {
							if (_this.request.data.Notification[notification_types[i]]) {
								notifications.enable.push(notification_types[i]);
							} else {
								notifications.disable.push(notification_types[i]);
							}
						}
					} else {
						notifications.disable = notification_types;
					}

					async.parallel([
						function (callback) {
							if (!notifications.enable.length) {
								return callback();
							}

							_this.Notification.update(
								{email: 1},
								{email: 0, account_id: user.dataValues.id, type: notifications.enable}
							).success(function () {
								if (notifications.enable.indexOf('broadcast') >= 0) {
									_this.Sendgrid.add(user.language + ' - Total Users', user.email, user.first_name);
									_this.Sendgrid.add(user.language + ' - ' + (user.profile_image ? '' : 'No') +' Photo', user.email, user.first_name);
									_this.Sendgrid.add(user.language + ' - ' + (user.affiliate ? '' : 'No') + ' Photo', user.email, user.first_name);
								}

								callback();
							});
						},
						function (callback) {
							if (!notifications.disable.length) {
								return callback();
							}

							_this.Notification.update(
								{email: 0},
								{email: 1, account_id: user.dataValues.id, type: notifications.disable}
							).success(function () {
								if (notifications.disable.indexOf('broadcast') >= 0) {
									_this.Sendgrid.delete_all(user.email);
								}

								callback();
							});
						}
					], function () {
						var dir, ext, pic, is, os;

						if (picture) {
							if (amp.config.env === 'development') {
								ext	= picture.substr(picture.lastIndexOf('.')).toLowerCase();
								pic	= amp.constants.webroot + '/images/users/' + user.dataValues.id + ext;
								is	= fs.createReadStream(picture);
								os	= fs.createWriteStream(pic);

								is.pipe(os);
								is.on('end', function () {
									fs.unlink(picture);

									_this._import('Component', 'Sendgrid');
									_this.Sendgrid.delete(user.language + ' - No Photo', user.email);
									_this.Sendgrid.add(user.language + ' - Photo', user.email, user.first_name);

									gm(pic)
										.autoOrient()
										.noProfile()
										.resize(200, 200, '^')
										.gravity('Center')
										.crop(200, 200)
										.write(pic, function (err) {
										_this._getPicture(user.dataValues.id, function (picture) {
											if (picture !== (user.dataValues.id + ext)) {
												fs.unlink(amp.constants.webroot + '/images/users/' + picture, function () {
													redirect();
												});
											} else {
												redirect();
											}
										});
									});
								});
							} else {
								dir = '/images/users/' + user.dataValues.id + '/';
								ext = picture.substr(picture.lastIndexOf('.')).toLowerCase();
								pic = _this._password(Math.random() + '-' + Date.now()) + ext;

								gm(picture)
									.autoOrient()
									.noProfile()
									.resize(200, 200, '^')
									.gravity('Center')
									.crop(200, 200)
									.toBuffer(function (err, buffer) {
									knox.putBuffer(buffer, dir + pic, {
										'x-amz-acl': 'public-read',
										'x-amz-meta-uid': user.dataValues.id,
										'x-amz-meta-mtime': Date.now(),
										'Cache-Control': 'max-age=86400, s-maxage=3600',
										'Content-Type': 'image/' + ext.substr(1).replace('jpg', 'jpeg')
									}, function (err, resp) {
										if (err) {
											return redirect();
										}

										_this._import('Component', 'Sendgrid');
										_this.Sendgrid.delete(user.language + ' - No Photo', user.email);
										_this.Sendgrid.add(user.language + ' - Photo', user.email, user.first_name);

										user.updateAttributes({profile_image: pic}).success(function () {
											_this.Session.set('User.profile_image', pic, function () {
												redirect();
												knox.deleteFile(picture, function () {});
											});
										});
									});
								});
							}
						} else {
							redirect();
						}

						function redirect() {
							var url = '/account/settings';

							if (_this.request.language !== _this.request.data.Account.language) {
								url = 'https://' + _this.request.data.Account.language + '.' + _this.domain.domain + url;
							}

							_this.redirect(url);
						}
					});
				}).error(function (err) {
					if (err[0].code === 'ER_DUP_ENTRY') {
						_this.Session.flash('This affiliate link has already been taken. Please try another one.');
					} else {
						_this.Session.flash('An error occurred. Please try again.');
					}

					_this.redirect('/account/settings');
				});
			} else {
				results = {};

				_this._set('user', user);
				_this._set('genders', _this.Account.enumValues('gender', true));

				async.each(notification_types, function (item, callback) {
					_this.Notification.findOrCreate({account_id: user.dataValues.id, type: item}, {email: 1, sms: 1}).success(function (n) {
						results[item] = n.email;

						callback();
					});
				}, function (err) {
					_this._import('Model', 'Location');

					_this._getCache('Location:list:countries', ['id', 'name'], function (err, countries) {
						_this._getCache('Location:list:states', ['iso', 'name'], function (err, states) {
							_this._set('notifications', results);
							_this._set('countries', countries);
							_this._set('states', states);

							_this._suggestAffiliate(function (err, data) {
								if (data) {
									_this._set('suggestions', data);
								}

								_this.render();
							});
						});
					});
				});
			}
		});
	},

	affiliate_check: function (value) {
		var _this = this;

		this.Account.find({
			attributes: ['affiliate'],
			where: {
				affiliate: value
			}
		}).success(function (results) {
			if (results) {
				_this._set('data', 1);
			} else {
				_this._set('data', 0);
			}

			_this._layout = false;
			_this.render('/layouts/json');
		});
	},

	_validateAffiliate: function (data, doBad) {
		var accept	= /^[a-z0-9](?![a-z0-9_-]*?[_-]{2,}[a-z0-9_-]*?)[a-z0-9_-]{3,18}[a-z0-9]$/i,
			bad		= /(official|neurs)/;

		if (!data || !accept.test(data)) {
			return false;
		} else if (doBad && bad.test(data)) {
			return false;
		}

		return true;
	},

	_suggestAffiliate: function (cb) {
		var _this		= this,
			suggestions	= [],
			lowered		= [],
			data		= _this.Session.get('User');

		suggest(data.first_name);
		suggest(data.last_name);
		suggest(data.email.split('@')[0]);
		suggest(data.first_name + ' ' + data.last_name);
		suggest(data.first_name + ' ' + data.last_name);
		suggest(data.first_name[0] + ' ' + data.last_name);
		suggest(data.first_name + ' ' + data.last_name[0]);
		suggest(data.last_name + ' ' + data.first_name[0]);

		suggestions = suggestions.filter(function (elm, pos, arr) {
			return arr.indexOf(elm) === pos;
		});

		suggestions.forEach(function (elm) {
			var lower = elm.toLowerCase();

			if (lowered.indexOf(lower) === -1) {
				lowered.push(lower);
			} else {
				suggestions.splice(suggestions.indexOf(elm), 1);
			}
		});

		this.Account.findAll({
			attributes: ['affiliate'],
			where: {
				affiliate: lowered
			}
		}).success(function (results) {
			if (results) {
				results.forEach(function (result) {
					var index = lowered.indexOf(result.affiliate.toLowerCase());

					if (index > -1) {
						suggestions.splice(index, 1);
					}
				});
			}

			suggestions.sort(function() {
				return .5 - Math.random();
			}).splice(6);

			cb(null, suggestions);
		}).error(cb);

		function suggest(entry) {
			suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '').replace(/(^[_-]|[_-]{2,}|[_-]$)/, ''));
			suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '-').replace(/(^[_-]|[_-]{2,}|[_-]$)/, '-'));
			suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '_').replace(/(^[_-]|[_-]{2,}|[_-]$)/, '_'));

			if (isNaN(entry.substr(-1))) {
				suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '').replace(/(^[_-]|[_-]{2,}|[_-]$)/, '') + parseInt(Math.random() * 1000));
				suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '-').replace(/(^[_-]|[_-]{2,}|[_-]$)/, '-') + parseInt(Math.random() * 1000));
				suggestions.push(entry.replace(/[^a-z0-9_-]/gi, '_').replace(/(^[_-]|[_-]{2,}|[_-]$)/, '_') + parseInt(Math.random() * 1000));
			}
		}
	},

	delete: function () {
		var _this;

		if (!this.Session.get('User.id')) {
			this.redirect('/accounts/login');
			return;
		}

		if (this.request.method === 'POST') {
			_this = this;

			this.Account.find({
				attributes: ['id', 'email', 'language'],
				where: {id: this.Session.get('User.id')}
			}).success(function (user) {
				user.updateAttributes({deleted: 1, deleted_date: new Date()}).success(function () {
					_this.Session.destroy(function () {
						_this.redirect('/');
					});

					_this.Referral.update({
						status: 'optout'
					}, {
						email: user.email
					});

					_this._import('Component', 'Sendgrid');
					_this.Sendgrid.delete_all(user.email);
				});
			});
		} else {
			this.render();
		}
	},

	forgot: function () {
		this.redirect(this.request.url.replace(/forgot/, 'password'));
	},

	password: function (id, modified) {
		var _this = this;

		if (this.Session.get('User.id')) {
			this.redirect('/referrals/invite');
			return;
		}

		if (this.request.method === 'POST' && !id && !modified && this.request.data) {
			this.Account.find({
				attributes: ['id', 'email', 'first_name', 'modified'],
				where: {email: this.request.data.Account.email, deleted: 0}
			}).success(function (user) {
				if (user) {
					_this._import('Component', 'Emails');

					_this.Emails.set('user', {
						id: user.id,
						first_name: user.first_name,
						modified: user.modified,
						hash: crypto.createHash('md5').update((user.modified || '').toString()).digest('hex')
					});

					_this.Emails.send({
						account_id: user.id,
						to: user.email,
						subject: 'Did you forget your NEURS password?',
						layout: 'email',
						template: 'forgot_password'
					});
				}

				_this.Session.flash('Please check your email for instructions on resetting your password.');
				_this.render();
			});
		} else if (id && modified) {
			this.Account.find({
				attributes: ['id', 'modified'],
				where: {id: id, deleted: 0}
			}).success(function (user) {
				var data = crypto.createHash('md5').update((user && user.modified || '').toString()).digest('hex');

				if (user && data === modified) {
					if (_this.request.method === 'POST' && _this.request.data) {
						data = _this.request.data.Account;

						if (!data.password || data.password.length < 8) {
							_this.Session.flash('Your password must contain at least 8 characters');
							_this.render('password2');
							return;
						} else if (data.password !== data.password_confirm) {
							_this.Session.flash('Your passwords did not match');
							_this.render('password2');
							return;
						}

						user.updateAttributes({
							password: _this._password(data.password)
						});

						_this.Session.flash('Your new password has been saved. Please log in below.');
						_this.redirect('/account/login');
					} else {
						_this.render('password2');
					}
				} else {
					_this.redirect('/');
				}
			});
		} else {
			this.render();
		}
	},

	register: function (step, isAffiliate) {
		var data, where1, where2,
			_this = this;

		if (this.configs && this.configs.registration === '0') {
			return this.render(403);
		} else if (this.Session.get('User.id')) {
			return this.redirect('/referrals/invite');
		}

		if (this.request.method === 'POST' && this.request.data) {
			data = this.request.data.Account;

			where1 = [
				'status = ? AND ((email != "" AND email = ?) OR (phone_number != "" AND phone_number = ?)) AND modified > ? AND deleted = 0',
				'pending', data.email || '', data.mobile_phone || '', new Date(Date.now() - 1000 * 60 * 60 * 72)
			];

			where2 = [
				'deleted = 0 AND ((email != "" AND email = ?) OR (mobile_phone != "" AND mobile_phone = ?))',
				data.email || '', data.mobile_phone || ''
			];

			switch (parseInt(step)) {
				case 1:
					async.parallel([
						function (callback) {
							_this.Referral.findAll({
								attributes: ['account_id', 'first_name', 'last_name', 'email', 'phone_number'],
								where: where1,
								order: 'created DESC'
							}).success(function (referrals) {
								callback(!referrals || !referrals.length, referrals);
							}).error(callback);
						},
						function (callback) {
							_this.Account.count({where: where2, limit: 1}).success(function (count) {
								if (!count) {
									return callback();
								}

								_this.Session.flash('general', {
									class: 'success',
									message: 'It seems like you already have an account with us. Please try logging in. If you have forgotten your password, you can create a new password using the link below.'
								}, function () {
									_this.redirect('/account/login');
								});
							}).error(callback);
						}
					], function (error, results) {
						if (error) {
							return _this.render('no_invitation');
						}

						if (typeof step !== 'number') {
							_this.Session.flash({
								class: 'success',
								message: 'Congratulations! You have been invited to join us. However, before we can tell you more and allow you to see what we are up to, we need to know who you are. Please complete the registration form below and click JOIN to get started.'
							});
						}

						_this._import('Model', 'Location');
						_this._import('Model', 'Timezone');

						_this._getCache('Location:list:countries', ['id', 'name'], function (err, countries) {
							_this._getCache('Timezone:list', ['id', 'time', 'description'], function (err, timezones) {
								countries		= amp.extend({}, countries);
								timezones		= amp.extend({}, timezones);
								countries['']	= '';
								timezones['']	= '';

								_this._set('country', '');
								_this._set('tz', '');
								_this._set('countries', countries);
								_this._set('timezones', timezones);
								_this._set('genders', _this.Account.enumValues('gender', true));

								_this._clientInfo(function (err, info) {
									var user = {uplines: {length: 1, '': ''}, email: _this.request.data.Account.email};

									if (!err && info) {
										_this._set('ip', info);

										Object.keys(countries).forEach(function (key) {
											if (info.country_name === countries[key]) {
												_this._set('country', key);
											}
										});

										_this.Timezone.find({
											attributes: ['id'],
											where: {name: info.time_zone}
										}).success(function (tz) {
											if (tz) {
												_this._set('tz', tz.dataValues.id);
											}

											_this._updateUser(user, results[0]);
										});
									} else {
										_this._updateUser(user, results[0]);
									}
								});
							});
						});
					});
				break;

				case 2:
					async.parallel([
						function (callback) {
							if (isAffiliate === true) {
								return callback();
							}

							_this.Referral.count({where: where1, order: 'created DESC'}).success(function (count) {
								if (count === 0) {
									_this.Session.flash('Sorry, you must register using the email address or phone number that was used to invite you. If you wish to change your contact information, you may do so once your registration is complete.');

									callback(true);
								} else {
									callback();
								}
							}).error(callback);
						},
						function (callback) {
							_this.Account.count({where: where2, limit: 1}).success(function (count) {
								if (!count) {
									return callback();
								}

								_this.Session.flash('general', {
									class: 'success',
									message: 'It seems like you already have an account with us. Please try logging in. If you have forgotten your password, you can create a new password using the link below.'
								}, function () {
									_this.redirect('/account/login');
								});
							}).error(callback);
						}
					], function (error) {
						var allowed	= [
							'parent_id', 'email', 'mobile_phone', 'password', 'gender', 'first_name',
							'last_name', 'country_id', 'timezone_id', 'language', 'membership_plan_id'
						];

						if (error) {
							return _this.register(1);
						}

						if (!data.parent_id) {
							_this.Session.flash('A valid referrer must be chosen');
							_this.register(1);
							return;
						} else if (!data.password || data.password.length < 8) {
							_this.Session.flash('Your password must contain at least 8 characters');
							_this.register(1);
							return;
						} else if (data.password !== data.password_confirm) {
							_this.Session.flash('Your passwords did not match');
							_this.register(1);
							return;
						} else if (!data.terms) {
							_this.Session.flash('You must agree to the Terms of Service.');
							_this.register(1);
							return;
						}

						// TODO: Check if country activated and redirect to PAID signup.

						data.password			= _this._password(data.password);
						data.membership_plan_id	= isAffiliate === true ? '-1' : '0';

						_this.Account.create(data, {fields: allowed}).success(function (user) {
							_this.Referral.update({
								status: 'successful'
							}, [
								'((email != "" AND email = ?) OR (phone_number != "" AND phone_number = ?)) AND account_id = ?',
								data.email || '', data.mobile_phone || '', data.parent_id
							]);

							_this.Referral.update({
								status: 'unavailable'
							}, [
								'((email != "" AND email = ?) OR (phone_number != "" AND phone_number = ?)) AND account_id != ?',
								data.email || '', data.mobile_phone || '', data.parent_id
							]);

							_this._import('Component', 'Emails');

							_this.Emails.set('user', user.dataValues);

							_this.Emails.send({
								account_id: user.id,
								to: user.email,
								subject: ['%s, welcome on board!', user.first_name],
								layout: 'email',
								template: 'LANG/registration'
							});

							if (_this.configs && _this.configs['upgrading'] > 0) {
								user.level(function (level) {
									if (_this.configs['upgrade_level'] >= level) {
										_this.Emails.set('user', user.dataValues);

										_this.Emails.send({
											account_id: user.id,
											to: user.email,
											subject: 'Upgrade now!',
											layout: 'email',
											template: 'LANG/upgrade_signup'
										});
									}
								});
							}

							_this._import('Component', 'Sendgrid');

							_this.Sendgrid.add(user.language + ' - Total Users', user.email, user.first_name);
							_this.Sendgrid.add(user.language + ' - No Photo', user.email, user.first_name);
							_this.Sendgrid.add(user.language + ' - No Access', user.email, user.first_name);
							_this.Sendgrid.add(user.language + ' - Not Affiliate', user.email, user.first_name);

							//_this._sendUpdateEmails(user.dataValues);

							_this.Account.find({
								attributes: ['id', 'email', 'first_name', 'language'],
								where: {id: user.parent_id, deleted: 0}
							}).success(function (parent) {
								//_this.Emails.set('parent', parent.dataValues);

								/*_this.Emails.send({
									account_id: parent.id,
									to: parent.email,
									subject: ['%s, your REACH is growing!', parent.first_name],
									layout: 'email',
									template: 'accepted_invite'
								});*/

								_this.Account.children(parent, true, function (direct_users) {
									if (direct_users === 3) {
										_this.Emails.set('user', parent.dataValues);

										_this.Emails.send({
											account_id: parent.id,
											to: parent.email,
											subject: ['%s, welcome to VIP status!', parent.first_name],
											layout: 'email',
											template: 'reward_vip'
										});

										_this.Sendgrid.delete(user.language + ' - No Access', user.email);
										_this.Sendgrid.add(parent.language + ' - VIP Room', parent.email, parent.first_name);
									} else if (direct_users === 6) {
										_this.Emails.set('user', parent.dataValues);

										_this.Emails.send({
											account_id: parent.id,
											to: parent.email,
											subject: ['%s, you did it! You now have access to the Start NOW! book', parent.first_name],
											layout: 'email',
											template: 'reward_book'
										});

										_this.Sendgrid.add(parent.language + ' - Start NOW! Book', parent.email, parent.first_name);
									}

									if (isAffiliate === true) {
										_this.Emails.set('user', user.dataValues);
									} else {
										_this.Session.set('User', user.dataValues);
									}

									_this.redirect('/');
								});
							});
						});
					});
				break;

				default:
					this.render();
				break
			}
		} else {
			this.render();
		}
	},

	_updateUser: function (user, referrals) {
		var i,
			_this		= this,
			referral	= referrals.shift(),
			allowed		= ['first_name', 'last_name', 'phone_number'];

		for (i in referral.dataValues) {
			if (allowed.indexOf(i) > -1) {
				user[i] = user[i] || referral.dataValues[i];
			}
		}

		this.Account.find({
			attributes: ['first_name', 'last_name'],
			where: {id: referral.account_id, deleted: 0}
		}).success(function (account) {
			if (account) {
				user.uplines.length++;
				user.uplines[referral.account_id] = account.first_name + ' ' + account.last_name;
			}

			if (referrals.length) {
				_this._updateUser(user, referrals);
			} else {
				_this._set('referral', user);
				_this.render('extended_info');
			}
		});
	},

	_sendUpdateEmails: function (user) {
		var _this = this;

		this.Account.path(user.id, ['id', 'country_id', 'email', 'first_name'], function (err, path) {
			if (err) {
				return;
			}

			async.eachSeries(path, function (upline, callback) {
				_this.Account.levels(upline, function (err, levels) {
					if (!err && levels.pop() === 1) {
						_this.Emails.set('entry', upline);

						_this.Emails.send({
							account_id: upline.id,
							to: upline.email,
							subject: 'Your REACH is on the move!',
							layout: 'email',
							template: 'new_level'
						});

						callback();
					} else {
						callback(1); // stop
					}
				});
			});

			/*async.eachLimit(path, 10, function (upline, callback) {
				if (String(user.country_id) === String(upline.country_id)) {
					callback(1); //stop
				}

				_this.Account.count({
					where: ['lft > ? AND rght < ? AND country_id = ?', upline.lft, upline.rght, user.country_id]
				}).success(function (count) {
					if (count === 1) {
						_this.Emails.set('entry', 'upline');

						_this.Emails.send({
							account_id: upline.id,
							to: upline.email,
							subject: 'Mr. Worldwide has nothing on you!',
							layout: 'email',
							template: 'new_country'
						});

						callback();
					} else {
						callback(1); // stop
					}
				});
			});*/
		});
	},

	upgrade: function (step) {
		var data, affiliate, affiliate_id, plan, recurring,
			_this = this;

		if (!this.Session.get('User.id')) {
			this.render(404);
			return;
		}

		step = step < 1 ? 1 : step;

		switch (parseInt(step)) {
			case 1:
				this.AccountPermission.count({
					where: {
						action: 'upgrade',
						account_id: this.Session.get('User.id'),
						allowed: [-1, 1]
					},
					limit: 1
				}).success(function (perm) {
					var plan, recurring, affiliate;

					if (!perm) {
						_this.render(403);
						return;
					}

					//_this.Account.count({where: {membership_plan_id: 7}}).success(function (count) {
						_this._set('FM', true); //count < 1000);
						_this.render();
					//});
				});
			break;

			case 2:
				if (this.Session.get('Upgrade') === true) {
					return this.redirect('/account/upgrade_info');
				} else if (this.Session.get('User.active') > 0) {
					return this.redirect('http://my.' + this.domain.domain + '/login');
				}

				if (this.request.method === 'POST') {
					/*switch (_this.request.data.Account.membership_plan) {
						case 'fm-o':
							plan		= 7;
							recurring	= 'one_time';
						break;

						case 'fa-o':
							plan		= 8;
							recurring	= 'one_time';
						break;

						case 'e-m':
							plan		= 2;
							recurring	= 'monthly';
						break;

						case 'e-a':
							plan		= 2;
							recurring	= 'annual';
						break;

						case 'p-m':
							plan		= 3;
							recurring	= 'monthly';
						break;

						case 'p-a':
							plan		= 3;
							recurring	= 'annual';
						break;
					}*/

					switch (_this.request.data.Account.affiliate_program) {
						case 'a-pa':
							affiliate_id	= 3;
							affiliate		= 'Affiliate Partner';
						break;

						case 'a-pr':
							affiliate_id	= 2;
							affiliate		= 'Affiliate Pro';
						break;

						case 'a':
							affiliate_id	= 1;
							affiliate		= 'Affiliate';
						break;

						default:
							affiliate_id	= 0;
							affiliate		= false;
						break;
					}

					this.Session.set('Upgrades', {
						plan: plan,
						recurring: recurring,
						affiliate: affiliate,
						affiliate_id: affiliate_id
					});	
				} else if (data = this.Session.get('Upgrades')) {
					plan			= data.plan;
					recurring		= data.recurring;
					affiliate		= data.affiliate;
					affiliate_id	= data.affiliate_id;
				} else {
					this.upgrade(1);
					return;
				}

				this._import('Model', 'MembershipPlan');
				this._import('Model', 'MembershipPlanPrice');

				async.parallel({
					fm: function (callback) {
						if (plan !== 7) {
							return callback();
						}

						_this.Account.count({where: {membership_plan_id: 7}}).success(function (count) {
							callback(count < 1000 ? null : true);
						}).error(callback);
					},
					plan: function (callback) {
						//if (!plan) {
							return callback(null, {});
						//}

						_this.MembershipPlanPrice.find({
							where: {
								membership_plan_id: plan,
								fee: recurring,
								deleted: 0
							},
							include: [_this.MembershipPlan]
						}).success(function (plan) {
							if (plan) {
								callback(null, amp.extend({}, plan.dataValues, {
									membership_plan: plan.membershipPlan.dataValues
								}));
							} else {
								callback(null, false);
							}
						}).error(callback);
					},
					affiliate: function (callback) {
						if (!affiliate) {
							return callback(null, {});
						}

						_this.MembershipPlanPrice.find({
							where: {
								membership_plan_id: 9,
								fee: affiliate.toLowerCase().replace(' ', '_'),
								deleted: 0
							}
						}).success(function (plan) {
							if (plan) {
								callback(null, amp.extend({}, plan.dataValues, {
									id: affiliate_id,
									name: affiliate
								}));
							} else {
								callback(null, false);
							}
						}).error(callback);
					}
				}, function (err, results) {
					var i, amount,
						max		= 17,
						years	= {'0': ''},
						current	= new Date().getFullYear();

					if (err) {
						_this.Session.flash('An error occurred. Please try again.');
						_this.redirect('/account/upgrade');
						return;
					}

					for (i = 0; i < max; i++) {
						years[current + i] = current + i;
					}

					amount = parseInt(results.plan.amount || 0) + parseInt(results.affiliate.amount || 0);

					if (amount === 0) {
						return _this.Session.flash('general', 'You have officially upgraded to an Affiliate account. Do not press the "back" button on your browser.', function () {
							_this._finalize_upgrade(results, amount);
						});
					}

					_this._import('Component', 'Paypal');

					_this._set('years', years);
					_this._set('plan', results.plan);
					_this._set('affiliate', results.affiliate);
					_this._set('amount', amount);

					_this.Session.set('Upgrades.results', results);

					_this._set('paypal_link', _this.Paypal.create(amount, affiliate, {
						return_url: _this.domain.scheme + _this.domain.full + '/account/upgrade/3?payment=paypal',
						cancel_url: _this.domain.scheme + _this.domain.full + '/account/upgrade'
					}, function (err, link) {
						if (!err && link) {
							_this._set('paypal_link', link);
						}

						_this.render('upgrade_billing');
					}));
				});
			break;

			case 3:
				if (this.Session.get('Upgrade') === true) {
					return this.redirect('/account/upgrade_info');
				} else if (this.Session.get('User.active') > 0) {
					return this.redirect('http://my.' + this.domain.domain + '/login');
				} else if (this.request.method !== 'POST' && _this.request.query.payment !== 'paypal') {
					return this.upgrade(1);
				}

				data = _this.Session.get('Upgrades.results');

				if (!data) {
					return _this.upgrade(1);
				}

				if (_this.request.query.payment === 'paypal') {
					_this._import('Component', 'Paypal');

					_this.Paypal.execute(function (err, transaction) {
						if (err) {
							return _this.Session.flash('general', 'Your PayPal transaction did not go through. Try again or try another payment method.', function () {
								_this.upgrade(2);
							});
						}

						paypal_data		= transaction.payer.payer_info;
						paypal_data.ip	= _this.request.headers['x-forwarded-for'] || _this.request.connection.remoteAddress;

						_this._import('Model', 'PaymentMethod');

						_this.PaymentMethod.create({
							account_id: _this.Session.get('User.id'),
							type: 'paypal',
							account_number: paypal_data.payer_id,
							withdraw_priority: 1,
							verified: 1,
							active: 1,
							data: JSON.stringify(paypal_data)
						}).success(function (pm) {
							var amount = parseInt(data.plan.amount || 0) + parseInt(data.affiliate.amount || 0);

							_this._import('Model', 'Transaction');

							_this.Transaction.create({
								account_id: _this.Session.get('User.id'),
								market_id: 1,
								payment_method_id: pm.id,
								amount: amount,
								type: 'registration',
								status: 'complete'
							});

							_this.Session.flash('Your PayPal payment has been processed successfully!');

							_this._finalize_upgrade(data, amount);
						});
					});
				} else {
					data.cc = _this._cc_info(_this.request.data.CreditCard.number);
				
					if (!data.cc || !data.cc.IIN || !data.cc.valid) {
						return _this.Session.flash('general', 'Your Credit Card is not valid. Please enter a valid Credit Card', function () {
							_this.upgrade(2);
						});
					}

					async.parallel({
						duplicates: function (callback) {
							gateway.customer.search(function (search) {
								search.creditCardNumber().is(_this.request.data.CreditCard.number);
							}, callback);
						},
						pm: function (callback) {
							_this._import('Model', 'PaymentMethod');

							_this.PaymentMethod.create({
								account_id: _this.Session.get('User.id'),
								type: 'credit_card',
								account_number: '',
								withdraw_priority: 1,
								data: JSON.stringify({
									name: _this.request.data.CreditCard.cardholderName,
									type: data.cc.IIN,
									expiration: {
										month: _this.request.data.CreditCard.expirationMonth,
										year: _this.request.data.CreditCard.expirationYear
									},
									ip: _this.request.headers['x-forwarded-for'] || _this.request.connection.remoteAddress
								})
							}).success(function (payment_method) {
								callback(null, payment_method);
							}).error(callback);
						}
					}, function asyncCallback (err, results) {
						var amount = parseInt(data.plan.amount || 0) + parseInt(data.affiliate.amount || 0);

						if (err) {
							results.pm && results.pm.destroy();
							_this.Session.flash('Your Credit Card payment did not go through. Please verify your credit card details.');
							return _this.redirect('/account/upgrade/2');
						} else if (results.duplicates.ids.length >= 5) {
							results.pm && results.pm.destroy();
							_this.Session.flash('We could not charge your Credit Card because it has been used by two other users. Please use a different Credit Card to upgrade.');
							return _this.redirect('/account/upgrade/2');
						}

						_this._transact({
							amount: amount,
							customer: {
								id: _this.Session.get('User.id'),
								firstName: _this.Session.get('User.first_name'),
								lastName: _this.Session.get('User.last_name')
							},
							creditCard: amp.extend({}, _this.request.data.CreditCard, {
								token: results.pm.id
							}),
							billing: _this.request.data.Billing,
							options: {
								storeInVaultOnSuccess: true,
								submitForSettlement: true
							}
						}, function (err, result) {
							if (err || result.success !== true) {
								asyncCallback(err || true, results);
								return;
							}

							_this.Session.flash('Your Credit Card payment has been processed successfully!');

							results.pm.updateAttributes({
								account_number: result.transaction.creditCard.maskedNumber,
								verified: 1,
								active: 1
							});

							_this._import('Model', 'Transaction');

							_this.Transaction.create({
								account_id: _this.Session.get('User.id'),
								market_id: 1,
								payment_method_id: results.pm.id,
								amount: amount,
								type: 'registration',
								status: 'complete'
							});

							_this._finalize_upgrade(data, amount);
						});
					});
				}
			break;

			default:
				this.upgrade(1);
			break;
		}
	},

	_transact: function (data, callback) {
		gateway.transaction.sale(data, function (err, result) {
			if (!err && result && result.success === true) {
				return callback(err, result);
			}

			delete data.billing;

			gateway.transaction.sale(data, callback);
		});
	},

	_finalize_upgrade: function (data, amount) {
		var _this	= this,
			invoice	= [];

		// TODO - Set parent
		this.Session.del('Upgrades');

		this.Account.update({
			membership_plan_id: data.plan.membership_plan_id || 6,
			billing_type: data.plan.fee || (data.affiliate.fee ? 'affiliate' : 'monthly'),
			last_billing_date: new Date(),
			credits: data.plan.membership_plan && data.plan.membership_plan[(data.plan || data.affiliate || {}).fee + '_credits'] || 0
		}, {
			id: this.Session.get('User.id')
		});

		this.Session.set('User.membership_plan_id', data.plan.membership_plan_id || 6);
		this.Session.set('User.last_billing_date', new Date());
						
		this.AccountPermission.destroy({account_id: this.Session.get('User.id'), action: 'upgrade'});

		if (data.plan && data.plan.membership_plan) {
			invoice.push({
				plan: data.plan.membership_plan.name,
				price: parseInt(data.plan.amount || 0),
				recurring: data.plan.fee
			});
		}

		if (data.affiliate && data.affiliate.name) {
			invoice.push({
				plan: data.affiliate.name,
				price: parseInt(data.affiliate.amount || 0),
				recurring: 'affiliate'
			});

			this.AccountPermission.create({
				account_id: this.Session.get('User.id'),
				action: 'affiliate',
				allowed: data.affiliate.id
			});
		}

		this._import('Model', 'Invoice');

		this.Invoice.create({
			account_id: this.Session.get('User.id'),
			type: 'registration',
			data: JSON.stringify(invoice)
		});

		this.Session.set('Upgrade', true, function () {
			_this.redirect('/account/upgrade_info');
		});
	},

	_cc_info: function (num) {
		var i, data,
			sum	= 0,
			_2	= 0;

		if (isNaN(num) || !num.length) {
			return false;
		}

		num		+= '';
		data	= {
			IIN: false,
			valid: false
		};

		switch (num[0]) {
			case '3':
				if ((_2 = num.substr(0, 2)) == 34 || _2 == 37) {
					data.IIN = "AmEx";
				}
			break;

			case '4':
				data.IIN = "Visa";
			break;

			case '5':
				if ((_2 = num.substr(0, 2)) > 50 && _2 < 56) {
					data.IIN = "MasterCard";
				}
			break;

			case '6':
				if (num.substr(0, 4) == 6011 || num.substr(0, 3) == 644 || num.substr(0, 2) == 65) {
					data.IIN = "Discover";
				}
			break;
		}

		for (i in num) {
			sum += parseInt(num[i]);

			if ((i % 2 && num.length % 2) || (!(i % 2) && !(num.length % 2))) {
				if (num.length != (i + 1)) {
					sum += parseInt(num[i] > 4 ? num[i] - 9 : num[i]);
				}
			}
		}

		data.valid = sum % 10 ? false : true;

		return data;
	},

	upgrade_info: function () {
		var i, fields, data, years, encrypted,
			_this	= this,
			errors	= [],
			years	= {},
			year	= (new Date).getFullYear();

		if (!this.Session.get('User.id')) {
			return this.render(404);
		} else if (this.Session.get('Upgrade') !== true) {
			return this.redirect('/account/upgrade');
		} else if (this.Session.get('User.active') > 0) {
			return this.redirect('http://my.' + this.domain.domain + '/login');
		}

		Array
			.apply(null, Array(year - 17))
			.map(function (_, i) {return i;})
			.splice(year - 100)
			.map(function (i) {years[i] = i;});

		this._set('years', years);

		if (this.request.method === 'POST') {
			data	= this.request.data.Account;
			fields	= ['email', 'mobile_phone', 'address', 'city', 'country_id', 'zip_code', 'timezone_id'];

			for (i in fields) {
				if (!(fields[i] in data) || !data[fields[i]]) {
					errors.push(fields[i]);
				}
			}

			if (!data.birthdate || !data.birthdate.month || !data.birthdate.day || !data.birthdate.year) {
				errors.push('birthdate');
			}

			if (errors.length) {
				this.Session.flash('Please fill out the required fields: %s'.format(errors.join(', ')));
				return render();
			}

			if (!data.terms1 || !data.terms2) {
				this.Session.flash('You must agree to all of the terms in order to continue.');
				return render();
			}

			i				= new Date();
			data.birthdate	= new Date(data.birthdate.year, data.birthdate.month, parseInt(data.birthdate.day) + 1);

			i.setFullYear(i.getFullYear() - 18);

			if (data.birthdate > i) {
				this.Session.flash('You must be 18 years of age or older in order to upgrade and have an account on My.NEURS.com.');
				return render();
			}

			if (data.country_id === '243') {
				if (
					!data.data.ssn ||
					!/^\d{3}-?\d{2}-?\d{4}$/.test(data.data.ssn.trim()) ||
					data.data.ssn !== data.data.ssn_confirm
				) {
					this.Session.flash('You must provide a valid Social Security Number');
					return render();
				}

				encrypted = {
					id_type: 'ssn',
					ssn: data.data.ssn.trim()
				};
			} else {
				switch (data.data.id_type) {
					case 'national_id':
						if (!data.data.national_id.trim() || !data.data.country_id.trim()) {
							this.Session.flash('You must provide a valid National ID');
							return render();
						}

						encrypted = {
							id_type: 'national_id',
							national_id: data.data.national_id.trim(),
							country_id: data.data.country_id.trim()
						};
					break;

					case 'passport':
						if (
							!data.data.passport_number.trim() ||
							!data.data.issue_date.trim() ||
							!data.data.expiry_date.trim() ||
							!data.data.country_id.trim()
						) {
							this.Session.flash('You must provide a valid Passport ID');
							return render();
						}

						encrypted = {
							id_type: 'passport',
							passport_number: data.data.passport_number.trim(),
							issue_date: data.data.issue_date.trim(),
							expiry_date: data.data.expiry_date.trim(),
							country_id: data.data.country_id.trim()
						};
					break;

					case 'driver_license':
						if (
							!data.data.license_number.trim() ||
							!data.data.expiry_date.trim() ||
							!data.data.country_id.trim()
						) {
							this.Session.flash('You must provide a valid Driver License');
							return render();
						}

						encrypted = {
							id_type: 'driver_license',
							license_number: data.data.license_number.trim(),
							expiry_date: data.data.expiry_date.trim(),
							country_id: data.data.country_id.trim()
						};
					break;
				}
			}

			data = {
				email: data.email,
				alternate_email: data.alternate_email,
				mobile_phone: data.mobile_phone,
				secondary_phone: data.secondary_phone,
				address: data.address,
				city: data.city,
				state: data.state,
				country_id: data.country_id,
				location_id: data.country_id,
				zip_code: data.zip_code,
				birthdate: data.birthdate,
				marital_status_id: data.marital_status_id,
				timezone_id: data.timezone_id,
				active: 1,
				created: Date.now(),
				modified: Date.now()
			};

			if (encrypted) {
				data.encrypted_data = this._encrypt(JSON.stringify(encrypted));
			}

			if (data.email !== this.Session.get('User.email')) {
				return this.Account.count({where: {email: data.email}}).success(function (count) {
					if (count) {
						_this.Session.flash('The email address is already is use.');
						return render();
					}

					save();
				});
			}

			save();

			function save() {
				_this.Account.update(data, {
					id: _this.Session.get('User.id')
				}).success(function () {
					_this.Session._setCookie();
					_this.Session.set('User.active', true);
					_this.Session.set('intro_video', true);
					_this.redirect('http://my.' + _this.domain.domain + '/login');

					if (_this.permissions.affiliate > 1) {
						_this._import('Model', 'Invoice');

						_this.Invoice.find({
							attributes: ['id'],
							where: {account_id: _this.Session.get('User.id')},
							order:  'id DESC'
						}).success(function (invoice) {
							_this._import('Component', 'Emails');

							_this.Emails.set('first_name', _this.Session.get('User.first_name'));
							_this.Emails.set('invoice_id', invoice.id);

							_this.Emails.send({
								to: _this.Session.get('User.email'),
								subject: ['%1$s, you\'ve upgraded. What\'s next?', _this.Session.get('User.first_name')],
								layout: 'email',
								template: 'paid_affiliate_upgrade'
							});
						});
					}
				}).error(function () {
					_this.Session.flash('We were not able to update your details. Please make sure all of the required fields have been completed correctly.');
					render();
				});
			}
		} else {
			render();
		}

		function render() {
			_this._import('Model', 'Location');
			_this._import('Model', 'Timezone');
			_this._import('Model', 'AccountPermission');

			_this._getCache('Location:list:countries', ['id', 'name'], function (err, countries) {
				_this._getCache('Location:list:states', ['iso', 'name'], function (err, states) {
					_this._getCache('Timezone:list', ['id', 'time', 'description'], function (err, timezones) {
						_this.AccountPermission.count({
							where: {
								account_id: _this.Session.get('User.id'),
								action: 'affiliate',
								allowed: [1, 2, 3]
							},
							limit: 1
						}).success(function (affiliate) {
							_this._set('countries', countries);
							_this._set('states', states);
							_this._set('timezones', timezones);
							_this._set('affiliate', !!affiliate)
							_this.render();
						});
					});
				});
			});
		}
	},

	upgrade_reset: function () {
		if (!this.Session.get('User.id')) {
			return this.render(404);
		} else if (!this.permissions.affiliate || this.permissions.affiliate > 1) {
			return this.render(404);
		}

		if (this.request.method === 'POST' && this.request.data) {
			this._import('Model', 'AccountPermission');
			this._import('Model', 'Transaction');
			this._import('Model', 'Invoice');
			this._import('Model', 'PaymentMethod');

			this.Session.del('Upgrade');
			this.Session.del('Upgrades.results');
			this.Session.del('Upgrades');

			this.Session.set('User.membership_plan_id', 0);
			this.Session.set('User.active', 0);

			this.Account.update(
				{membership_plan_id: 0, active: 0},
				{id: this.Session.get('User.id')}
			);

			this.AccountPermission.update(
				{action: 'upgrade', allowed: -1},
				{account_id: this.Session.get('User.id'), action: 'affiliate'}
			).success(function () {
				this.Session.flash('general', 'Your account has now been reset. Please choose the affiliate account you would now like.', function () {
					this.redirect('/account/upgrade');
				}.bind(this));
			}.bind(this));

			this.Transaction.update(
				{deleted: 0, deleted_date: Date.now()},
				{account_id: this.Session.get('User.id')}
			);

			this.Invoice.update(
				{deleted: 0, deleted_date: Date.now()},
				{account_id: this.Session.get('User.id')}
			);

			this.PaymentMethod.update(
				{deleted: 0, deleted_date: Date.now()},
				{account_id: this.Session.get('User.id')}
			);

			return;
		}

		this.render();
	}
});
