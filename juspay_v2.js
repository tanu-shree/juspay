(function () {
    if (typeof window.console !== "object")
        window.console = {
            log: function (message) {},
            info: function (message) {},
            warn: function (message) {}
        };
} ());


(function() {

    var isMobile = function() {
        var ua;
        ua = navigator.userAgent;
        return (screen.width <= 720) || (screen.height <= 720) || /Android/i.test(ua) || /iPhone/i.test(ua) || /iPad/i.test(ua);
    };

    var start_time = new Date().getTime()
    var hostname = document.location.hostname
    var canAjax = hostname.indexOf("juspay.in") >= 0
    var baseUrl = "https://api.juspay.in"

    if(canAjax) {
        var protocol = document.location.protocol
        var port = document.location.port
        baseUrl = protocol + "//" + hostname + (port ? (":" + port) : "")
    }
    // canAjax = false // for now. we are implementing javascript based solution only.
    var chargeUrl = baseUrl + "/payment/handlePay"
    var statusUrl = baseUrl + "/order/status"
    var chargeNewUrl = baseUrl + "/txns"

    chargeUrl = chargeNewUrl

    var eventLogUrl = baseUrl + "/event/record"
    var addMetricUrl = baseUrl + "/event/addMetric"

    function logMetric(metricName, metricValue, dimensions) {
        /*
         var dims = JSON.stringify(dimensions)
         $.ajax({
         cache: false,
         dataType: 'jsonp',
         type: "POST",
         async: true,
         url: addMetricUrl,
         data: $.param({name: metricName, value: metricValue, dimensions: dims}),
         success: function(res){},
         error: function (xmlHttpRequest, textStatus, errorThrown) {}
         })
         */
    }

    function merge(target, obj1, obj2){
        for(var p in obj2){
            target[p] = (obj1[p] === undefined ? obj2[p] : obj1[p])
        }
        return target;
    }

    var status_list = {
        READY: "READY",
        PROCESSING: "PROCESSING",
        PROCESSING_3D: "3D_SECURE",
        SUCCESS: "SUCCESS",
        FAILURE: "FAILURE"
    }

    var defaults = {

        // typical external configuration
        payment_form: "#frm",
        success_handler: 0, // mandatory
        error_handler: 0, // mandatory
        form_error_handler: 0, // optional
        second_factor_window_closed_handler: 0, // optional

        // form fields

        field_order_id: ".order_id",
        field_product_id: ".product_id",
        field_amount: ".amount", // used for impulse cases
        field_merchant_id: ".merchant_id",
        field_gateway_id: ".gateway_id",

        field_customer_email: ".customer_email",
        field_customer_phone: ".customer_phone",
        field_card_token: ".card_token",

        field_payment_method_type: ".payment_method_type",
        field_payment_method: ".payment_method",

        field_card_number: ".card_number",
        field_name_on_card: ".name_on_card",
        field_card_security_code: ".security_code",
        field_card_exp_month: ".card_exp_month",
        field_card_exp_year: ".card_exp_year",
        field_juspay_locker_save: ".juspay_locker_save",
        field_redirect : ".redirect",

        field_is_emi : ".is_emi",
        field_emi_bank: ".emi_bank",
        field_emi_tenure: ".emi_tenure",

        field_offer_id: ".offer_id",

        submit_btn: ".make_payment",
        type: "inline"
    };

    var trackPageview = function(pageUrl) {
    };


    var Ajax = (function () {
        var buildRequest = function (successCallback, errorCallback) {
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function () {
                if(this.readyState == 4) {
                    if(this.status == 200) {
                        successCallback();
                    } else {
                        errorCallback();
                    }
                }
            };

            return xhr;
        };

        return {
            get: function (url, payload, successCallback, errorCallback) {
                var xhr = buildRequest(successCallback, errorCallback);
                xhr.open('GET', url, true);
                xhr.send(payload);
            },
            post: function (url, payload, successCallback, errorCallback) {
                var xhr = buildRequest(successCallback, errorCallback);
                xhr.open('POST', url, true);
                xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
                xhr.send(payload);
            }
        }
    })();

    /*
     Iframe sender is used to overcome the issue of CORS by forwarding requests to an Iframe
     which then performs the Async call to juspay backend.
     */
    var IframeSender = (function () {
        if(typeof window.postMessage !== 'function') {
            return null;
        }

        var iframeStatus = false;

        var iframeSource = baseUrl + '/payjs-iframe';

        var iframeWindow = (function () {
            var iframe = document.createElement('iframe');

            iframe.style.display = 'none';
            iframe.src = iframeSource;
            iframe.id = 'juspay-hidden-form' + new Date().getTime();

            var node = document.getElementsByTagName('body')[0];
            if(node) {
                node.appendChild(iframe)
            } else {
                node = document.getElementsByTagName('head')[0];
                node.appendChild(iframe);
            }
            return iframe.contentWindow;
        })();

        var dispatcher = (function (message) {
            // Hold the set of registered listeners for iframe events
            var register = {};

            return new function () {
                this.register = function (senderId, callback) {
                    register[senderId] = callback;
                };

                this.processMessage = function (message) {
                    register[message.senderId](message.messageId, message.payload);
                };

                /*
                 Ideally, sender must present itself so only it's own registration can be
                 undone here.
                 */
                this.unregister = function (sender) {
                    delete register[sender.senderId]
                };
            };
        })();

        var getSenderId = (function () {
            var senders = 0;

            return function () {
                var senderId = "SID_" + senders;
                senders += 1;
                return senderId;
            };
        })();

        window.onmessage = function (message) {
            message = JSON.parse(message.data);
            if(message.messageId === 'check-ok') {
                iframeStatus = true;
            } else {
                dispatcher.processMessage(message);
            }
        };

        // The sender constructor function
        var Sender = function (payload, success, err) {
            var senderId = getSenderId();

            // Maintain a counter for the messages that are sent
            var messageCounter = 0;

            // Set of callbacks that are maintained for each message
            var successCallbacks = {
                generic: function () {}
            };

            var errorCallbacks = {
                generic: function () {
                    alert('There has been an error, please retry.');
                }
            };

            // Pushes the message to the iframe and registers callbacks
            var pushMessage = function (url, payload, successCallback, errorCallback) {
                messageCounter += 1;
                var messageId = "MID_" + messageCounter;

                successCallbacks[messageId] = successCallback;
                errorCallbacks[messageId] = errorCallback;

                var message =  {
                    'url': url,
                    'messageId': messageId,
                    'senderId': senderId,
                    'payload': payload
                };

                iframeWindow.postMessage(JSON.stringify(message), iframeSource);
            };

            /*
             Execute callback once data for a queued message is returned by the Iframe.
             * If error and success callbacks are specified seperately, then call
             the corresponding error / success callback.
             * If only one callback is specified, assume it takes care of all cases
             and pass the response object to it.
             */
            var receiveMessage = function (messageId, response) {
                var callback;
                if(!successCallbacks[messageId] || !errorCallbacks[messageId]) {
                    callback = successCallbacks[messageId] || errorCallbacks[messageId];
                }
                else if(response.ok) {
                    callback = successCallbacks[messageId] || successCallbacks.generic;
                } else {
                    callback = errorCallbacks[messageId] || errorCallbacks.generic;
                }

                callback(response);

                delete successCallbacks[messageId];
                delete errorCallbacks[messageId];
            };

            dispatcher.register(senderId, receiveMessage);

            return pushMessage;
        };

        /*
         Decorator that takes in an implementation to be used, if provided.
         Appropriateley calls the iframe implementation or the provided implementation.
         */
        var wrapper = (function () {
            var iframeImplementation = new Sender();

            return function (providedImplementation) {
                return function (url, payload, successCallback, errorCallback) {
                    var implementation;
                    if(iframeStatus) {
                        implementation = iframeImplementation;
                    } else {
                        implementation = providedImplementation;
                    }

                    implementation.apply(null, [url, payload, successCallback, errorCallback]);
                };
            };
        })();

        return wrapper;
    })();

    function logEvent(data) {
        try {
            //Ajax.get(eventLogUrl, data, function() {}, function () {});
        } catch (e) {}
    }

    var MyJuspay = function(opts) {

        var id = new Date().getTime()

        var options = merge({}, opts, defaults)
        var status = status_list.READY
        var frm = document.querySelector(options.payment_form)

        var submit_btn = frm.querySelector(options.submit_btn)

        if(opts.type !== undefined && (opts.type == "inline" || opts.type == "express")) {
            options.type = opts.type
        } else {
            options.type = this.valueOf(frm.querySelector(".card_token")) ? "express" : "inline"
        }

        this.validate_form = function() {
            return 1 // TBD
        }

        this.get_status = function() {
            return status
        }

        this.set_type = function(new_type) {
            if(new_type !== undefined && (new_type == "inline" || new_type == "express")) {
                options.type = new_type
            }
            return options.type
        }

        var chargeHandler = 0
        var statusHandler = 0


        // Updated to use IframeSender
        var postChargeRequest = (function () {
            var impl = function (url, payload, callback) {
                Ajax.post(url, payload, callback, callback);
            };

            // If Iframe sender is avaialble, wrap the current implementation
            if(typeof IframeSender === 'function') {
                impl = new IframeSender(impl);
            }

            return impl;
        })();

        // Updated to use IframeSender
        // Reverting getCharge status back to JSONP
        var getChargeStatus = function(payload, callback) {
            var impl = function () {
                Ajax.post(statusUrl, payload, callback, function () {
                    alert("There has been an error. Please retry.")
                });
            };

            if(typeof IframeSender == 'function') {
                impl = new IframeSender(impl);
            }

            return impl;
        };


        var mapForTxns = function(params) {
            var newParams = {}
            var mapping = {
                "cardExpMonth": "card_exp_month",
                "cardExpYear": "card_exp_year",
                "cardSecurityCode": "card_security_code",
                "cardNumber": "card_number",
                "name": "name_on_card",
                "orderId": "order_id",
                "merchantId": "merchant_id",
                "emiBank": "emi_bank",
                "emiTenure": "emi_tenure",
                "isEmi": "is_emi",
                "cardToken": "card_token",
                "juspayLockerSave": "save_to_locker",
                "expressCheckout": "express_checkout",
                "redirect": "redirect_after_payment",
                "authentication_method": "authentication_method",
                "gatewayId": "gateway_id",
                "paymentMethodType": "payment_method_type",
                "paymentMethod": "payment_method"
            }
            for(var key in params) {
                if(mapping[key]) {
                    var newKey = mapping[key]
                    newParams[newKey] = params[key]
                }
            }
            newParams["format"] = "json"
            newParams["payjs_version"] = "v2"
            return newParams
        }

        this.extend = function(out) {
            out = out || {}

            for (var i = 1; i < arguments.length; i++) {
                if (!arguments[i])
                    continue;

                for (key in arguments[i]) {
                    if (arguments[i].hasOwnProperty(key))
                        out[key] = arguments[i][key]
                }
            }

            return out
        };

        this.toQueryString = function(obj) {
            var parts = [];
            for (var i in obj) {
                if (obj.hasOwnProperty(i)) {
                    parts.push(encodeURIComponent(i) + "=" + encodeURIComponent(obj[i]));
                }
            }
            return parts.join("&");
        };

        this.valueOf = function(element) {
            if(element) {
                return element.value;
            }
            else {
                return ""
            }
        };

        var enableButton = function (button) {
            if(!button) {
                return;
            }

            if(typeof button.classList == 'object') {
                button.classList.remove('disabled');
            } else {
                var classes= button.className.split(/\s+/g);
                classes.splice(classes.indexOf('disabled'), 1);
                button.className = classes.join(' ');
            }

            button.disabled = false;
        };

        var disableButton = function (button) {
            if(!button) {
                return;
            }

            if(typeof button.classList == 'object') {
                button.classList.add('disabled');
            } else {
                button.className += " disabled";
            }

            button.disabled = false;
        };

        // now write the submit handler
        this.submit_form = function() {
            var isValid = this.validate_form()
            var errors = 0
            if(isValid !== 1) {
                // not valid

            }
            else { // proceed to submit the form

                var submit_time = new Date().getTime()

                //disable the submit button
                disableButton(submit_btn);

                var merchant_id = this.valueOf(frm.querySelector(options.field_merchant_id))
                var order_id = this.valueOf(frm.querySelector(options.field_order_id))
                var gateway_id = this.valueOf(frm.querySelector(options.field_gateway_id))
                var amount = this.valueOf(frm.querySelector(options.field_amount))
                var customer_email = this.valueOf(frm.querySelector(options.field_customer_email))
                var customer_phone = this.valueOf(frm.querySelector(options.field_customer_phone))
                var product_id = this.valueOf(frm.querySelector(options.field_product_id))
                var is_emi = this.valueOf(frm.querySelector(options.field_is_emi))
                var emi_bank= this.valueOf(frm.querySelector(options.field_emi_bank))
                var emi_tenure= this.valueOf(frm.querySelector(options.field_emi_tenure))
                var offer_id = this.valueOf(frm.querySelector(options.field_offer_id))

                var payment_method_type = this.valueOf(frm.querySelector(options.field_payment_method_type));
                var payment_method = this.valueOf(frm.querySelector(options.field_payment_method));

                logEvent({o:order_id, d:"Time taken for submit: " + (submit_time - start_time)})

                logMetric("submit_latency",(submit_time - start_time),{"checkout_type": options.type,
                    "merchant": merchant_id})
                logEvent({o: order_id, d: "Submit form invoked"})
                var params = ""
                var card_number = ""
                var redirect_val = frm.querySelector(options.field_redirect).value;

                var paramsMap = {}

                if(typeof(is_emi) != "undefined") {
                    paramsMap["isEmi"] = is_emi
                    paramsMap["emiBank"] = emi_bank
                    paramsMap["emiTenure"] = emi_tenure
                }
                if(offer_id) {
                    paramsMap["offerId"] = offer_id
                }

                if(payment_method_type == "NB" || payment_method_type == "WALLET") {
                    this.extend(paramsMap, {
                        paymentMethodType: payment_method_type,
                        paymentMethod: payment_method,
                        orderId: order_id,
                        merchantId: merchant_id
                    })
                }

                else if(options.type == "inline") {
                    card_number = this.valueOf(frm.querySelector(options.field_card_number))
                    var card_exp_month = this.valueOf(frm.querySelector(options.field_card_exp_month))
                    var card_exp_year = this.valueOf(frm.querySelector(options.field_card_exp_year))
                    var card_security_code = this.valueOf(frm.querySelector(options.field_card_security_code))
                    var name_on_card = this.valueOf(frm.querySelector(options.field_name_on_card))

                    var juspay_locker_save = frm.querySelector(options.field_juspay_locker_save)
                    if(juspay_locker_save !== null)
                        juspay_locker_save = juspay_locker_save.checked

                    this.extend(paramsMap, {
                        cardNumber: card_number,
                        name: name_on_card,
                        cardExpMonth: card_exp_month,
                        cardExpYear: card_exp_year,
                        cardSecurityCode: card_security_code,
                        merchantId: merchant_id,
                        orderId: order_id,
                        juspayLockerSave: juspay_locker_save
                    })
                }

                else if(options.type == "express") {
                    var card_token = this.valueOf(frm.querySelector(options.field_card_token));
                    var card_security_code = this.valueOf(frm.querySelector(options.field_card_security_code));
                    this.extend(paramsMap, {
                        cardToken: card_token,
                        cardSecurityCode: card_security_code,
                        merchantId: merchant_id,
                        orderId: order_id,
                        expressCheckout: true
                    })
                }

                var setIfNotUndefined = function(name, val) {
                    if(val != undefined) {
                        paramsMap[name] = val
                    }
                };

                setIfNotUndefined("amount", amount)
                setIfNotUndefined("customerEmail", customer_email)
                setIfNotUndefined("customerPhone", customer_phone)
                setIfNotUndefined("productId", product_id)
                setIfNotUndefined("gatewayId", gateway_id)

                var newParams = mapForTxns(paramsMap) // Always sets the format to JSON

                params = this.toQueryString(newParams)
                var ie_version = msieversion()
                if(false && (redirect_val === "true" || isMobile())) {
                    // 2015-08-14 this block is effectively disabled.
                    // we will never get the card number to the URL as it could be cached sometimes
                    // by old browsers.
                    /*
                     if(window.parent) {
                     window.parent.location.href = chargeUrl + "?" + params
                     }
                     else {
                     window.location.href = chargeUrl + "?" + params
                     }

                     return false
                     */
                } else {
                    var secure_w = null
                    var noSecondFactor = gateway_id == '20'
                    if(!noSecondFactor && !(redirect_val === "true" || isMobile())) {
                        secure_w = Juspay.startSecondFactor(merchant_id, order_id, card_number, frm)
                    }
                    else {
                        paramsMap["redirect"] = true
                        paramsMap["authentication_method"] = "GET"
                        newParams = mapForTxns(paramsMap)

                        params = this.toQueryString(newParams)
                    }

                    postChargeRequest(chargeUrl, params, function (res){
                        logEvent({o:order_id, d:"HandlePay response received: " + res.status})
                        if(res.status == 'PENDING_VBV' || res.status == 'JUSPAY_DECLINED') { // needs vbv
                            var txnId = res["txn_id"]
                            var paymentObj = res["payment"]
                            var authObj = paymentObj["authentication"]
                            var authUrl = authObj["url"]
                            var authMethod = authObj["method"]
                            var authParams = authObj["params"]
                            res['serviceProvider'] = 'juspay'
                            // var params = $.param(res)
                            if(authMethod.toUpperCase() === "POST") {
                                var authFrm = document.createElement("form")
                                var authFrmId = "auth_form_" + new Date().getTime()
                                authFrm.method = authMethod
                                authFrm.action = authUrl
                                authFrm.setAttribute("id", authFrmId)
                                // var authFrm = $("<form/>").attr("action", authUrl).attr("method", authMethod).attr("id","auth_form")
                                for(var authKey in authParams) {
                                    var inp = document.createElement("input")
                                    inp.type = "hidden"
                                    inp.name = authKey
                                    inp.value = authParams[authKey]
                                    authFrm.appendChild(inp)
                                }
                                var outerElt = document.createElement("div")
                                outerElt.appendChild(authFrm)

                                var html = outerElt.innerHTML.replace(/&amp;/g, "&")
                                if(secure_w) {
                                    html += "<script type='text/javascript'>document.forms['" + authFrmId + "'].submit()</script>"
                                    var existing = secure_w.document.documentElement.innerHTML
                                    secure_w.document.open()
                                    secure_w.document.write(existing + html)
                                    secure_w.document.close()
                                } else {
                                    // Submit the form on the current page itself
                                    var body = document.querySelector('body')
                                    outerElt.style.display = 'none'

                                    body.appendChild(outerElt)
                                    authFrm.submit()
                                    return
                                }
                            }
                            else {
                                if(secure_w != null) {
                                    secure_w.location.href = authUrl
                                }
                                else {
                                    // Window.parent == window if we are at the top level window
                                    // in the hierarchy
                                    if(window.parent && window.parent !== window) {
                                        window.parent.location.href = authUrl
                                    }
                                    else {
                                        window.location.href = authUrl
                                    }
                                }
                            }
                            var si = 0
                            var check_counter = 0
                            var sf_closed_handler_invoked = 0
                            var payment_timed_out = 0
                            var check_vbv = function() {
                                if(secure_w.closed == true) {
                                    logEvent({o:order_id, d:"3D secure window has been closed."})
                                    // now check the transaction status
                                    getChargeStatus({orderId: order_id, merchantId: merchant_id, completeReturnUrl: true}, function(stat){
                                        if(stat.status == 'PENDING_VBV') {
                                            if(payment_timed_out == 1) {
                                                disableButton(submit_btn);
                                                logEvent({o:order_id, d:"3D secure window is closed due to timeout."})
                                                trackPageview("/acs_popup_closed_timeout")
                                            }
                                            else {
                                                enableButton(submit_btn)
                                                logEvent({o:order_id, d:"3D secure window is closed by user."})
                                                trackPageview("/acs_popup_closed_by_user")
                                            }
                                            if( typeof (options.second_factor_window_closed_handler) == "function") {
                                                if(!sf_closed_handler_invoked) {
                                                    options.second_factor_window_closed_handler()
                                                    sf_closed_handler_invoked = 1
                                                }
                                            }
                                        }
                                        else if(stat.status == 'CHARGED') {
                                            var success_time = new Date().getTime()
                                            logMetric("success_latency",(success_time - submit_time),{"checkout_type": options.type,
                                                "merchant": merchant_id})
                                            options.success_handler(status_list.SUCCESS, stat)
                                        } else {
                                            enableButton(submit_btn)
                                            options.error_handler(status_list.FAILURE, stat.errorMessage,
                                                stat.bankErrorCode, stat.bankErrorMessage, stat.gatewayId, stat)
                                        }
                                    }, 'json')
                                } else {
                                    if(merchant_id == 'nspi' || merchant_id == 'tspi'
                                        || merchant_id == 'spicinemas_testing') {
                                        var now = new Date().getTime()
                                        if( (now - start_time) > (260 * 1000) ) {
                                            // 5 minutes elapsed since loaded.
                                            // lets close the second factor window
                                            Juspay.stopSecondFactor()
                                            var msg = "Prematurely closing 3D secure window. Mark txn for cancellation."
                                            logEvent( {o:order_id, t:txnId, d:msg} )
                                            disableButton(submit_btn)
                                            window.setTimeout(check_vbv, 3000)
                                            payment_timed_out = 1
                                        }
                                        else {
                                            window.setTimeout(check_vbv, 1000)
                                        }
                                    }
                                    else {
                                        window.setTimeout(check_vbv, 1000)
                                    }
                                }

                                check_counter = check_counter + 1

                                if((check_counter % 30) == 0) {
                                    logEvent({o:order_id, d:"3D secure window is still open."})
                                }
                            }
                            si = window.setTimeout(check_vbv, 1000)
                        } else if(noSecondFactor) {
                            if(res.status == 'CHARGED') {
                                var success_time = new Date().getTime()
                                logMetric("success_latency",(success_time - submit_time),{"checkout_type": options.type,
                                    "merchant": merchant_id})
                                options.success_handler(status_list.SUCCESS, res)
                            } else {
                                enableButton(submit_btn)
                                options.error_handler(status_list.FAILURE, res.errorMessage,
                                    res.bankErrorCode, res.bankErrorMessage, res.gatewayId)
                            }
                        } else if(res.status == 'CHARGED') {
                            secure_w.close()
                            options.success_handler(status_list.SUCCESS, res)
                        } else {
                            secure_w.close()
                            disableButton(submit_btn)
                            logEvent({o: order_id, d:"Internal Server Error. Check logs."})
                            if(res['errorMessage']) {
                                alert("Something went wrong with your submission. Error: " + res['errorMessage'] + ". Please retry.")
                            } else {
                                alert("Something went wrong with your submission. Please retry.")
                            }
                        }
                    })
                }
            }
            return false
        }

        var jp = this

        frm.onsubmit = function (e) {
            e.preventDefault();

            jp.submit_form();
            return false;
        };

        return this
    }

    function msieversion() {
        var ua = window.navigator.userAgent
        var msie = ua.indexOf ( "MSIE " )

        if ( msie > 0 )      // If Internet Explorer, return version number
            return parseInt (ua.substring (msie+5, ua.indexOf (".", msie )))
        else                 // If another browser, return 0
            return 0
    }

    function inArray(arr, value) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] == value) return true;
        }
        return false;
    }

    var citi_bins = ["405450", "405451", "430463", "438587", "438628", "450900", "455038", "455390", "456407", "456822", "461795", "461796", "461797", "493714", "517700", "518371", "518936", "520386", "526421", "529117", "529495", "540165", "540175", "541497", "542556", "552093", "552137", "554619", "554637", "544170", "531662", "554637", "554637", "554619", "532662", "532663", "549777", "549778", "549779", "508159", "508125", "508126", "508192", "508227"]

    function isCitibankCard(cardNumber) {
        if(cardNumber && cardNumber.length > 6) {
            var bin = cardNumber.substring(0,6)
            return inArray(citi_bins, bin)
        }
        else {
            return false
        }
    }

    var second_factor_window = null

    window.Juspay = new function(){
        this.Setup = function (options) {
            return new MyJuspay(options)
        }

        this.startSecondFactor = function(merchant_id, order_id, card_number, frm) {
            if(second_factor_window && !second_factor_window.closed) {
                return second_factor_window
            } else {
                second_factor_window = Juspay.twoFactor(merchant_id, order_id, card_number, frm)
            }
            return second_factor_window
        }

        this.stopSecondFactor = function(merchant_id) {
            if(second_factor_window && !second_factor_window.closed)
                second_factor_window.close()
        }

        this.twoFactor = function(merchant_id, order_id, card_number, frm){
            // charge the card

            if(isMobile()) {
                // we are going to use redirect flow. so its no-op
                return
            }

            var p_img = merchant_id == 'redbus' ? ("https://api.juspay.in/images/redbus-processing.gif" + "?o=" + order_id) : "https://d3oxf4lkkqx2kx.cloudfront.net/images/processing.gif"
            var d_msg = "You will be redirected to your bank's website for 3D secure authentication."
            var r_msg = "Please do not refresh the page or click the back or close button of your browser."


            var popupAttrs = "height=440,width=800,left=200,top=150,location=1,status=1,scrollbars=1,screenX=200"
            if(isCitibankCard(card_number)) {
                popupAttrs = "height=600,width=1000,left=100,top=100,location=1,status=1,scrollbars=1,screenX=100"
            }
            if(this.valueOf(frm.querySelector("input.popup_attrs"))) {
                popupAttrs = this.valueOf(frm.querySelector("input.popup_attrs"));
            }
            var s_w = window.open("","mywindow",popupAttrs)
            setTimeout(function(){
                if(!s_w || s_w.closed || typeof s_w == "undefined" || typeof s_w.closed == "undefined") {
                    setTimeout(function(){
                        logEvent({o: order_id, d: "ACS Popup Blocked by browser"})
                        trackPageview("/acs_popup_blocked")
                    }, 10 * 1000) // dont want to get in the way of handlePay

                    var ie_version = msieversion()
                    if(ie_version > 0) {
                        if(ie_version == 8) {
                            alert("Oops. Popup blocked by browser. Please allow "
                                + window.location.hostname + " to open popup. Kindly retry after that. "
                                + "See above for details or check under Internet Options > Privacy > Settings.")
                        }
                        else {
                            alert("Oops. Popup blocked by browser. Please allow "
                                + window.location.hostname + " to open popup. Kindly retry after that. "
                                + "See below for details or check under Internet Options > Privacy > Settings.")
                        }
                    } else {
                        alert("Oops. Popup blocked by browser. Please allow "
                            + window.location.hostname + " to open popup. Kindly retry after that.")
                    }
                }
            }, 1 * 1000)
            if(s_w) {
                var sbj = "https://d3oxf4lkkqx2kx.cloudfront.net/images/secured-by-juspay-v1.jpg"
                var htstr = "<br><br><br><div align='center'><div style='font-size: 32px;'>"
                htstr += "<div><img src='" + p_img + "'></img><br><br>"
                htstr += "<div style='font-size: 16px;'>You will be redirected to your bank website for 3D secure authentication.</div>"
                htstr += "<p style='font-size: 16px; '>Please do not refresh the page or click the back or close button of your browser.</p>"
                htstr += "<br>  <img width=\"106\" height=\"59\" src='" + sbj + "'></img>"
                htstr += "<br><br></div></div></div>"
                s_w.document.write(htstr)
                s_w.document.close()
            }
            return s_w
        }

        this.validateCardNumber = function(value) {
            // accept only spaces, digits and dashes
            if (/[^0-9 -]+/.test(value))
                return false;
            var nCheck = 0,
                nDigit = 0,
                bEven = false;

            value = value.replace(/\D/g, "");

            for (var n = value.length - 1; n >= 0; n--) {
                var cDigit = value.charAt(n);
                var nDigit = parseInt(cDigit, 10);
                if (bEven) {
                    if ((nDigit *= 2) > 9)
                        nDigit -= 9;
                }
                nCheck += nDigit;
                bEven = !bEven;
            }

            return (nCheck % 10) == 0;
        }

    }

    var j_prefetch_map = {juspay: "https://api.juspay.in/welcome/blank",
        processing: "https://d3oxf4lkkqx2kx.cloudfront.net/images/processing.gif",
        icici: "https://3dsecure.payseal.com/MultiMPI/images/wait.gif",
        hdfc: "https://netsafe.hdfcbank.com/ACSWeb/images/1pixel.gif",
        sbj: "https://d3oxf4lkkqx2kx.cloudfront.net/images/secured-by-juspay-v1.jpg"
    }

    // append to the document a small 1*1 gif
    var j_prefetch_img = function(e) {
        if(j_prefetch_map[e]) {
            var img_src = j_prefetch_map[e]
            p_img = document.createElement("img")
            p_img.src = img_src
            p_img.cssText = "position:absolute; visibility:hidden"
            p_img.width = "0"
            p_img.height = "0"
            document.getElementsByTagName("head")[0].appendChild(p_img)
            // delete j_prefetch_map[e]
        }
    }
    j_prefetch_img("sbj")

})();