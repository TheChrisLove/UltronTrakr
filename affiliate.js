var amp		= require('amp.js'),
	async	= require('async'),
	crypto	= require('crypto'),
	Account	= require('./account')
	L10n	= require('l10n'),
	locale	= new L10n;

module.exports = Account.extend({
	_common: function (cb) {
		var allowed	= ['index', 'register'],
			lang	= this.request.route.params && this.request.route.params[0];

		if (allowed.indexOf(this.request.route.action) < 0) {
			return this.render(404);
		} else if (!lang) {
			if (this.request.accept && this.request.accept.languages) {
				lang = locale.info(this.request.accept.languages.getBestMatch(amp.config.L10n.supported.map(locale.map)));
				return this._super.redirect.call(this, '/l/' + locale.map(lang.locale));
			}

			return this._super.redirect.call(this, '/l/en');
		} else if (lang.length === 3 && lang !== locale.map(lang)) {
			return this._super.redirect.call(this, '/l/' + locale.map(lang));
		}

		lang					= locale.info(lang);
		lang.map				= locale.map(lang.locale);
		this.request.language	= lang.locale;

		if (amp.config.L10n.supported.indexOf(lang.locale) < 0) {
			if (amp.config.L10n.supported.indexOf(lang.fallback) < 0) {
				return this.redirect();
			}

			return this._super.redirect.call(this, '/l/' + lang.fallback);
		}

		this._set('language', lang);
		cb();
	},

	index: function () {
		var sub, affiliate,
			_this	= this,
			langs	= {},
			regexp	= /[a-z]{2}[_-][a-z]{2}/i;

		sub = this.request.headers.host.match(/^([^.]+).neurs.net$/);

		if (!sub) {
			return this.render(404);
		}

		affiliate = sub[1];

		amp.config.L10n.supported.forEach(function (lang) {
			langs[lang] = locale.info(lang).language;
		});

		this._set('languages', langs);
		this._set('config', amp.config);
		this._set('ga', amp.config.general && amp.config.general.ga);

		if (this.request.method === 'POST') {
			return this.register('2');
		}

		this.Account.find({
			attributes: ['id', 'first_name', 'last_name', 'profile_image'],
			where: {affiliate: affiliate, deleted: 0}
		}).success(function (user) {
			if (!user) {
				return _this.render(404);
			}

			_this._getPicture(user, function (picture) {
				_this._set('picture', picture);
			});

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
						if (!err && info) {
							_this._set('ip', info);

							Object.keys(countries).forEach(function (key) {
								if (info.country_name === countries[key]) {
									_this._set('country', key);
								}
							});

							_this._getCache('Timezone:find', {
								attributes: ['id'],
								where: {name: info.time_zone}
							}, function (tz) {
								if (tz) {
									_this._set('tz', tz.dataValues.id);
								}

								render();
							});
						} else {
							render();
						}

						function render() {
							_this._layout = 'basic';

							_this._set('title', 'Join');
							_this._set('affiliate', user.dataValues);
							_this.render();
						}
					});
				});
			});
		});
	},

	register: function (step) {
		if (this.configs && this.configs.registration === '0') {
			return this.render(403);
		}

		if (!step || step !== '2' || this.request.method !== 'POST') {
			return this.redirect();
		}

		this._import('Component', 'Emails');
		this.Emails.set('password', crypto.createHash('md5').update('').digest('hex'));

		this.request.data.Account.password			= this._password(Math.random() * 100000).substr(0, 10);
		this.request.data.Account.password_confirm	= this.request.data.Account.password;

		this._super.register.call(this, step, true);
	},

	redirect: function (location) {
		if (location) {
			if (location === '/') {
				this.Emails.set('password', crypto.createHash('md5').update('').digest('hex'));

				this.Emails.send({
					account_id: 0,
					to: this.request.data.Account.email,
					subject: ['%s, activate your account.', this.request.data.Account.first_name],
					layout: 'email',
					template: 'registration_password'
				});

				return this.render('registered');
			}

			if (amp.config.env === 'development') {
				return this._super.redirect.call(this, location);
			}

			return this._super.redirect.call(this, 'http://neurs.com' + location);
		}

		this._super.redirect.call(this, amp.config.env === 'development' ? '/affiliate' : '/');
	}
});
