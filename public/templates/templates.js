(function() {
  var template = Handlebars.template, templates = Handlebars.templates = Handlebars.templates || {};
templates['form'] = template({"compiler":[6,">= 2.0.0-beta.1"],"main":function(depth0,helpers,partials,data) {
    return "<div class=\"col-md-6\">\n    <form class=\"form-horizontal\">\n        <fieldset>\n            <legend>New Hater</legend>\n            <div class=\"control-group\">\n                <input class=\"form-control\" type=\"text\" name=\"name\" placeholder=\"Enter Your Name\" />\n            </div>\n            <br>\n            <div class=\"control-group\">\n                <input class=\"form-control\" type=\"text\" name=\"category\" placeholder=\"Enter Your Category\" />\n            </div>\n            <br>\n            <div class=\"control-group\">\n                <input class=\"form-control\" type=\"text\" name=\"url\" placeholder=\"Enter An URL\" />\n            </div>\n            <br>\n            <div class=\"control-group\">\n                <input class=\"form-control\" type=\"text\" name=\"imagepath\" placeholder=\"Enter Path To Your Image\" />\n            </div>\n            <br>\n            <div class=\"control-group pull-right\">\n                <button type=\"button\" class=\"btn btn-danger\">\n                    <span class=\"glyphicon glyphicon-remove\"></span> Cancel</button>\n                <button type=\"button\" class=\"btn btn-primary\">\n                    <span class=\"glyphicon glyphicon-ok\"></span> Save</button>\n            </div>\n        </fieldset>\n    </form>\n</div>";
},"useData":true});
templates['details'] = template({"compiler":[6,">= 2.0.0-beta.1"],"main":function(depth0,helpers,partials,data) {
    var helper, alias1=helpers.helperMissing, alias2="function", alias3=this.escapeExpression;

  return "<div>\n	<h1>"
    + alias3(((helper = (helper = helpers.name || (depth0 != null ? depth0.name : depth0)) != null ? helper : alias1),(typeof helper === alias2 ? helper.call(depth0,{"name":"name","hash":{},"data":data}) : helper)))
    + "</h1>\n	<p><span class=\"label\">"
    + alias3(((helper = (helper = helpers.category || (depth0 != null ? depth0.category : depth0)) != null ? helper : alias1),(typeof helper === alias2 ? helper.call(depth0,{"name":"category","hash":{},"data":data}) : helper)))
    + "</span></p>\n	<img src=\"photos/"
    + alias3(((helper = (helper = helpers.imagepath || (depth0 != null ? depth0.imagepath : depth0)) != null ? helper : alias1),(typeof helper === alias2 ? helper.call(depth0,{"name":"imagepath","hash":{},"data":data}) : helper)))
    + "\" class=\"img-polaroid\" />\n</div>\n<p></p>\n<button type=\"button\" class=\"btn btn-danger confirm-delete\">Delete</button>";
},"useData":true});
templates['menu'] = template({"1":function(depth0,helpers,partials,data) {
    var stack1, alias1=this.lambda, alias2=this.escapeExpression;

  return "        <li><a href=\"#/menu-items/"
    + alias2(alias1(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.url : stack1), depth0))
    + "\">"
    + alias2(alias1(((stack1 = (depth0 != null ? depth0.attributes : depth0)) != null ? stack1.name : stack1), depth0))
    + "</a></li>\n";
},"compiler":[6,">= 2.0.0-beta.1"],"main":function(depth0,helpers,partials,data) {
    var stack1;

  return "<ul>\n"
    + ((stack1 = helpers.each.call(depth0,(depth0 != null ? depth0.models : depth0),{"name":"each","hash":{},"fn":this.program(1, data, 0),"inverse":this.noop,"data":data})) != null ? stack1 : "")
    + "</ul>";
},"useData":true});
})();