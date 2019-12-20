'use strict';

const Joi = require('joi');
const Boom = require('boom');

var internals = {};

internals.schema = Joi.object().keys({
    methodsToSupport: Joi.array().optional(),
    log: Joi.boolean().optional(),
    setAllowHeader: Joi.boolean().optional(),
    allowHeadWithGet: Joi.boolean().optional()
}).optional();

var settings;

function determineMethods(methodsToSupport) {
    // compared methods from server.table will be lowercase
    return methodsToSupport ? methodsToSupport.map(method => {
        return method.toLowerCase();
    }) : ['get', 'post', 'delete', 'put', 'patch', 'options', 'trace'];
}

function add405Routes(routes, methodsToSupport, prefix) {
    log('Adding 405 responses for routes without methods: ' + determineMethods(methodsToSupport));
    var routes405 = [];
    var routePaths = {};

    // find which methods each route path currently supports
    routes.forEach((route) => {
        const currPath = route.path;
        const currMethod = route.method;
        // if this path has not yet been seen add all desired methods to not supported
        if (!routePaths[currPath]) {
            routePaths[currPath] = {
                unsupportedMethods: determineMethods(methodsToSupport),
                supportedMethods: []
            }
        }
        // if this method is supported, remove it from the list of unsupported methods for this route
        routePaths[currPath].unsupportedMethods.splice(routePaths[currPath].unsupportedMethods.indexOf(currMethod), 1);
        routePaths[currPath].supportedMethods.push(currMethod);
        log(currPath + ' supports ' + currMethod);
    });

    // add 405s to each route for every method not supported
    Object.keys(routePaths).forEach(route => {
        if (routePaths[route].unsupportedMethods.length > 0) {
            routes405.push(build405Route(route, routePaths[route], prefix));
        }
    });
    return routes405;
}

function log() {
    if (settings.log) {
        Array.prototype.slice.call(arguments).forEach(message => {
            console.log('| ' + message);
        });
    }
}

function determineAllowHeader(supported) {
    const indexOfGet = supported.indexOf('get');
    const headNotIncluded = supported.indexOf('head') === -1;
    if (settings.allowHeadWithGet && indexOfGet >= 0 && headNotIncluded) {
        supported.splice(indexOfGet + 1, 0, 'head');
    }
    return supported.join(', ').toUpperCase();
}

function build405Route(routePath, routeMethods, prefix) {
    log(routePath, '\tadding 405s for: ' + routeMethods.unsupportedMethods, '');
    return {
        path: prefix ? new RegExp('^\\' + prefix + '(.*)$').exec(routePath)[1] : routePath,
        method: routeMethods.unsupportedMethods,
        config: {
            description: 'Method Not Allowed Route',
            tags: ['methodNotAllowed']
        },
        handler: function (request, reply) {
            var err = Boom.methodNotAllowed();
            if (settings.setAllowHeader) {
                err.output.headers['allow'] = determineAllowHeader(routeMethods.supportedMethods);
            }
            throw (err)
        }
    };
}

module.exports = {
    name: 'methodValidation',
    register: function (server, options) {
        const validOptions = Joi.validate(options, internals.schema);
        settings = validOptions.value;
        var newRoutes = add405Routes(server.table(), settings.methodsToSupport, server.realm.modifiers.route.prefix);
        log('Adding ' + newRoutes.length + ' new \"Method Not Allowed\" routes');
        server.route(newRoutes);
    }
}
