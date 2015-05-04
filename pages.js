var amp			= require('amp.js'),
	L10n		= require('l10n'),
	Affiliate	= require('./affiliate.js'),
	locale		= new L10n;

module.exports = amp.AppController.extend({
	_models: false,

	_common: function (cb) {
		if (this.request.route.action === 'index' && /\.neurs\.net$/.test(this.request.headers.host)) {
			return this._affiliateSetup();
		}

		this._super._common.call(this, function () {
			var l1, l2;

			if (this.request.language) {
				l1 = locale.info(this.request.language);

				if (this.request.accept && this.request.accept.languages) {
					l2 = this.request.accept.languages.getBestMatch(amp.config.L10n.supported.map(locale.map));
					l2 = locale.info(l2);

					if (l1.fallback !== l2.fallback) {
						this._set('fallbackLanguage', [locale.info(l1.fallback), locale.info(l2.fallback)]);
					}
				}
			}

			cb();
		}.bind(this));
	},

	index: function (page) {
		var _this = this;

		if (!page && this.Session.get('User.id')) {
			return this.redirect('/referrals/invite');
		} else if (page && page !== 'index' && page in this) {
			return this.redirect('/pages/' + page);
		} else if (page && page !== 'index') {
			this._set('title', amp.string.humanize(page));
			return this.render(page);
		}

		this._import('Model', 'Location');

		this._set('video_url', this._getVideo());

		this._clientInfo(function (err, info) {
			_this._getCache('Location:list:countries', ['iso', 'name', 'activated'], function (err, countries) {
				if (!err && info) {
					_this._set('ip', info);
					_this._set('activated', countries[info.country_code] && countries[info.country_code][1] > 0);

					Object.keys(countries).forEach(function (key) {
						countries[key] = countries[key][0];
					});
				}

				_this._set('countries', countries);
				_this.share();
			});
		});
	},

	_affiliateSetup: function () {
		var _this		= this,
			req			= this.request,
			controller	= new Affiliate;

		req.route.controller	= 'affiliate';
		controller._name		= 'affiliate';
		controller.request		= req;
		controller.response		= this.response;

		controller._init.call(controller, function (err, result) {
			if (!err) {
				controller._common.call(controller, function (err, result) {
					if (!err) {
						if (!controller._rendered) { // redirected or just plain rendered
							controller._set('video_url', _this._getVideo());
							controller[req.route.action].apply(controller, req.route.params);
						}
					}
				});
			}
		});
	},

	_getVideo: function () {
		var videos = {
			ita: '87186735',
			es_es: '84467935',
			spa: '84467936',
			por: '87489487',
			deu: '88717983',
			dut: '88716967',
			bul: '88716966'
		};

		return videos[this.request.language] || '84467934';
	},

	contact: function () {
		if (this.request.method === 'POST' && this.request.data) {
			this._import('Component', 'Emails');

			this.Emails.set('data', this.request.data.Account);

			this.Emails.send({
				to: 'info@neurs.com',
				subject: 'Contact Form Entry',
				layout: 'email',
				template: 'contact_form'
			});

			this.Session.flash('Your email has been sent!');
		}

		this.render();
	},

	share: function () {
		this._set({
			facebook_link: 'https://www.facebook.com/dialog/feed'
				+ '?app_id=526159214108961'
				+ '&link=http://neurs.com'
				+ '&picture='
				+ '&name=NEURS.com'
				+ '&caption=Concepts.%20Connections.%20Capital'
				+ '&description=Online%20Community%20for%20Entrepreneurs.%20%5BInvite%20Only%5D'
				+ '&redirect_uri=http://neurs.com' + this.request.url,
			twitter_link: 'https://twitter.com/share'
				+ '?text=Can%20anyone%20%23invite%20me%20to%20http://neurs.com%3F%20%23NEURS&',
			linkedin_link: 'http://www.linkedin.com/shareArticle'
				+ '?mini=true'
				+ '&url=http://neurs.com'
				+ '&title=NEURS.com'
				+ '&source=NEURS'
				+ '&summary=Online%20Community%20for%20Entrepreneurs.%20%5BInvite%20Only%5D',
			googleplus_link: 'https://plus.google.com/share'
				+ '?url=http://neurs.com'
		});

		this.render();
	}
});
