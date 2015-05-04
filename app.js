var amp		= require('amp.js'),
	cache	= {},
	fs		= require('fs'),
	net		= require('net'),
	geoip	= require('geoip'),
	crypto	= require('crypto'),
	L10n	= require('l10n'),
	locale	= new L10n,
	city4	= new geoip.City(amp.constants.libs + '/geoip/GeoLiteCity.dat'),
//	city6	= new geoip.City6(amp.constants.libs + '/geoip/GeoLiteCityv6.dat'),
	domains	= /^(([a-z0-9_-]{2,20})\.)?((local(dev|host)|nodedev|neurs(inc|))(\.(com|tv|net))?)(:(\d+))?$/;

module.exports = amp.Controller.extend({
	_components: ['Session'],
	_helpers: ['Form', 'Session', 'Gettext', 'CDN'],

	_common: function (cb) {
		var _this		= this,
			langs		= {},
			domainMatch	= this.request.headers.host.match(domains),
			sub			= domainMatch[2],
			domain		= domainMatch[3],
			isLocalhost	= ~domain.indexOf('local') || ~domain.indexOf('nodedev');

		this.domain = {
			scheme: domain === 'neurs.com' ? 'https://' : 'http://',
			full: domainMatch[0],
			subDot: domainMatch[1] || '',
			sub: domainMatch[2],
			domain: domainMatch[3],
			base: domainMatch[4],
			tld: domainMatch[8],
			port: domainMatch[10] || 80
		};

		this._set('domain', domain);

		if (this.domain.tld === 'tv') {
			if (this.request.route.controller === 'pages' && this.request.route.action === 'index') {
				return this.redirect('http://' + this.domain.subDot + domain + '/tv');
			}

			return this.redirect(this.domain.scheme + this.domain.subDot +this.domain.base + '.com' + this.request.url);
		}

		if (sub && sub !== 'www') {
			if (sub.length === 3 && sub !== locale.map(sub)) {
				sub = locale.map(sub);

				if (sub) {
					return this.redirect(this.domain.scheme + sub + '.' + domain + this.request.url);
				} else {
					return this.redirect(this.domain.scheme + domain + this.request.url);
				}
			}

			sub		= locale.info(sub);
			sub.map	= locale.map(sub.locale);

			if (!sub.language) {
				return this.redirect(this.domain.scheme + domain + this.request.url);
			}

			if (amp.config.L10n.supported.indexOf(sub.locale) < 0) {
				if (amp.config.L10n.supported.indexOf(sub.fallback) < 0) {
					return this.redirect(this.domain.scheme + domain + this.request.url);
				} else {
					return this.redirect(this.domain.scheme + sub.fallback + '.' + domain + this.request.url);
				}
			}
		} else if (this.request.accept && this.request.accept.languages) {
			sub		= locale.info(this.request.accept.languages.getBestMatch(amp.config.L10n.supported.map(locale.map)));
			sub.map	= locale.map(sub.locale);

			if (!isLocalhost) {
				return this.redirect(this.domain.scheme + sub.map + '.' + domain + this.request.url);
			}
		} else {
			sub		= locale.info('eng');
			sub.map	= locale.map('eng');

			if (!isLocalhost) {
				return this.redirect(this.domain.scheme + sub.map + '.' + domain + this.request.url);
			}
		}

		this.request.language = sub.locale;

		this._import('Model', 'Config');
		this._import('Model', 'Account');
		this._import('Model', 'AccountPermission');

		amp.config.L10n.supported.forEach(function (lang) {
			langs[lang] = locale.info(lang).language;
		});

		this._set('language', sub);
		this._set('languages', langs);
		this._set('config', amp.config);
		this._set('url', this.request.url);
		this._set('isLocalhost', isLocalhost);
		this._set('ga', amp.config.general && amp.config.general.ga);

		this._getCache('Config:list', ['name', 'value'], function (err, configs) {
			_this.configs = configs;

			if (!_this.Session.get('User.id')) {
				_this._set('user', false);
				cb();
				return;
			}

			_this.Account.find({
				attributes: [
					'id', 'first_name', 'last_name', 'email', 'mobile_phone', 'profile_image', 'membership_plan_id',
					'country_id', 'state', 'timezone_id', 'language', 'deleted', 'import_count', 'active'
				],
				where: {
					id: parseInt(_this.Session.get('User.id'))
				}
			}).success(function (user) {
				_this._set('user', user && user.dataValues);

				if (!user) {
					return cb();
				} else if (user.dataValues.deleted > 0) {
					if (_this.request.url != '/account/logout') {
						return _this.redirect('/account/logout');
					}
				}

				_this._import('Model','BlogPost');

				_this._getCache('BlogPost:findAll',{
					where:{
						language: _this.request.language,
						status: 'public',
						deleted: 0
					},
					attributes: ['id', 'title', 'created'],
					limit: 6,
					order: '`created` DESC'
				}, function (err, posts){
					var recent_posts,
					    redis = amp.stores.redis;

					if (err || !posts || !posts.length) {
						return;
					}

					recent_post = _this.Session.get('last_notified_' + user.id);

					if (recent_post && posts[0].created.getTime() < recent_post){
						return;
					}

					_this._set('recent_posts', posts);
					_this.Session.set('last_notified_' + user.id, Date.now());
				});

				if (!sub && user.language) {
					sub						= locale.info(user.language);
					sub.map					= locale.map(user.language);
					_this.request.language	= user.language;

					_this._set('language', sub);
				}

				_this._getPicture(user, function (picture) {
					if (picture) {
						_this._set('user_picture', picture);
					} else {
						_this._set('user_picture', '/account/picture');
					}

					_this.AccountPermission.list(['action', 'allowed', 'created'], {
						where: {
							account_id: user.id,
							deleted: 0
						}
					}).success(function (perms) {
						_this.permissions = {};

						Object.keys(perms).forEach(function (key) {
							_this.permissions[key]			= perms[key][0];
							_this.permissions[key].created	= perms[key][1];
						});

						_this._set('permissions', _this.permissions);

						if (!_this.permissions.affiliate /*_this.permissions.upgrade > 0 || _this.permissions.upgrade < 0*/) {
							if (!perms.upgrade || !(perms.upgrade[0] > 0 || perms.upgrade[0] < 0)) {
								_this.AccountPermission.findOrCreate({
									account_id: user.id,
									action: 'upgrade'
								}, {
									allowed: -1,
									created: Date.now(),
									deleted: 0
								});
							}

							_this._import('Model', 'Location');

							_this._getCache('Location:find:countries', user.country_id, function (err, country) {
								if (!_this.request.url.match(/^\/account\/(upgrade|settings)/) && country && country.activated > 0) {
									if (((new Date) - perms.upgrade[1]) >= (24 * 60 * 60 * 1000)) {
										_this.redirect('/account/upgrade');
										return;
									}
								}

								if (!_this.request.url.match(/^\/account\/upgrade/)) {
									_this.Session.flash('video', {
										class: 'success',
										message: 'Your time has come! Take advantage of this amazing opportunity:',
										action: 'Upgrade now!',
										href: '/account/upgrade',
										title: 'Why upgrade?',
										video_type: 'vimeo',
										video_id: ~['spa', 'es_es'].indexOf(_this.request.language) ? '89671559' : '89671558'
									}, cb);
								} else {
									cb();
								}
							});
						} else if (user.membership_plan_id > 0 && user.active < 1) {
							if (/^\/($|pages|account\/(logout|upgrade_info|upgrade_reset))/.test(_this.request.url)) {
								return cb();
							}

							_this.Session.set('Upgrade', true, function () {
								_this.redirect('/account/upgrade_info');
							});
						} else {
							cb();
						}
					}).error(cb);
				});
			}).error(cb);
		});
	},

	_getCache: function (type, input, callback, force) {
		var base, split,
			_this	= this,
			name	= type + JSON.stringify(input);

		if (!cache[name]) {
			cache[name] = {
				data: null,
				timeout: 0
			};
		}

		if (!cache[name].data || force === true) {
			clearTimeout(cache[name].timeout);

			split	= type.split(':');
			base	= this[split[0]];

			if (split[2]) {
				base = base.scope(split[2]);
			}

			base[split[1]](input).success(function (data) {
				cache[name].data	= data;
				cache[name].timeout	= setTimeout(function () {
					cache[name].data = null;
				}, 1000 * 60 * 10);

				callback(null, data);
			}).error(callback);
		} else {
			callback(null, cache[name].data);
		}
	},

	_getPicture: function (user, callback) {
		var id			= typeof user === 'object' && user.id ? user.id : user,
			cdn			= amp.config.cdn[amp.config.env].replace(/\/$/, ''),
			external	= cdn + '/images/users/' + id + '/',
			internal	= cdn + '/images/icons/',
			image		= internal + 'Dude@2x.png';

		if (parseInt(this.Session.get('User.id')) === parseInt(user)) {
			if (this.Session.get('User.profile_image')) {
				image = external + this.Session.get('User.profile_image');
			} else if (this.Session.get('User.gender') === 'female') {
				image = internal + 'Girl@2x.png';
			}

			return callback(image);
		}

		if (typeof user === 'object' && user.id) {
			if (user.profile_image) {
				image = external + user.profile_image;
			} else if (user.gender === 'female') {
				image = internal + 'Girl@2x.png';
			}

			callback(image);
		} else {
			this.Account.find({
				attributes: ['gender', 'profile_image'],
				where: {id: id}
			}).success(function (user) {
				if (user && user.dataValues.profile_image) {
					image = external + user.dataValues.profile_image;
				} else if (user && user.dataValues.gender === 'female') {
					image = internal + 'Girl@2x.png';
				}

				callback(image);
			});
		}
	},

	_clientInfo: function (callback) {
		var version, city,
			ip		= this.request.connection.remoteAddress,
			forward	= this.request.headers['x-forwarded-for'];

		if (version = net.isIP(forward)) {
			ip = forward;
		} else {
			if (ip === '127.0.0.1') {
				ip = '98.203.78.22';
			}

			version = net.isIP(ip);
		}

		if (version === 4) {
			city4.lookup(ip, callback);
		} else if (version === 6) {
			city6.lookup(ip, callback);
		} else {
			callback && callback();
		}
	},

	_referralStatus: function (id, callback) {
		var _this = this;

		this._import('Model', 'Account');
		this._import('Model', 'Referral');

		this.Account.findAll({
			attributes: ['id', 'first_name', 'last_name', 'email', 'mobile_phone', 'profile_image', 'membership_plan_id'],
			where: {parent_id: id, deleted: 0}
		}).success(function (users) {
			_this.Referral.findAll({
				attributes: ['id', 'email', 'phone_number', 'status', 'first_name', 'last_name', 'created', 'modified'],
				where: {account_id: id, deleted: 0, status: ['pending', 'unavailable', 'optout', 'expired']}
			}).success(function (referrals) {
				var boxCount,
					date			= (new Date).getTime() - 1000 * 60 * 60 * 72,
					total			= 0,
					successful		= 0,
					completed		= [],
					nearComplete	= [],
					pending			= [],
					unavailable		= [],
					expired			= [];

				users.forEach(function (user) {
					var values = {
						id: user.dataValues.id,
						first_name: user.dataValues.first_name,
						last_name: user.dataValues.last_name,
						email: user.dataValues.email,
						phone_number: user.dataValues.mobile_phone,
						name: user.dataValues.first_name + ' ' + user.dataValues.last_name,
						picture: '/images/icons/Dude@2x.png'
					};

					_this._getPicture(user.dataValues, function (image) {
						values.picture = image;
					});

					if (user.dataValues.membership_plan_id < 0) {
						nearComplete.push(values);
					} else {
						completed.push(values);
					}

					total++;
					successful++;
				})

				referrals.forEach(function (referral) {
					referral.dataValues.name = referral.dataValues.first_name + ' ' + referral.dataValues.last_name;

					switch (referral.status) {
						/*case 'successful':
							completed.push(referral.values);
						break;*/

						case 'pending':
						case 'read':
							if (referral.dataValues.modified.getTime() > date) {
								pending.push(referral.dataValues);
							} else {
								expired.push(referral.dataValues);
							}
						break;

						case 'unavailable':
						case 'optout':
						case 'bounced':
							unavailable.push(referral.dataValues);
						break;

						case 'expired':
							expired.push(referral.dataValues);
						break;

						default:
							total--;
						break;
					}

					total++;
				});

				if (successful < 6 && (successful + pending.length) <= 6) {
					boxCount = 6;
				} else {
					boxCount = (parseInt(((successful + pending.length) - 6) / 24) + 1) * 24 + 6;
				}

				callback({
					boxCount: boxCount,
					available: boxCount - total,
					totalAvailable: boxCount - successful - pending.length,
					unavailable: unavailable,
					expired: expired,
					completed: completed,
					nearComplete: nearComplete,
					successful: successful,
					pending: pending
				});
			});
		});
	},

	_encrypt: function (data) {
		var hmac, cipher;

		hmac = crypto
			.createHmac('sha256', amp.config.security.salt)
			.update(amp.config.security.cipherSeed)
			.digest('hex');

		cipher = crypto.createCipher('aes-256-cbc', hmac);
		return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
	},

	_decrypt: function (data) {
		var hmac, decipher;

		hmac = crypto
			.createHmac('sha256', amp.config.security.salt)
			.update(amp.config.security.cipherSeed)
			.digest('hex');

		decipher = crypto.createDecipher('aes-256-cbc', hmac);
		return decipher.update(data, 'hex', 'utf8') + decipher.final('utf8');
	}
});
