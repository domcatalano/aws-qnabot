var _=require('lodash')
const slackifyMarkdown = require('slackify-markdown');
const utf8 = require('utf8');
const qnabot = require("qnabot/logging")



// PARSE FUNCTIONS

// When using QnABot in Amazon Connect call center, filter out 'filler' words that callers sometimes use
// filler words are defined in setting CONNECT_IGNORE_WORDS
// If inPutTranscript contains only filler words, return true.
function isConnectClient(req) {
    if (_.get(req,"_event.requestAttributes.x-amz-lex:accept-content-types", undefined) === undefined) {
        return false;
    }
    return true;
}
function trapIgnoreWords(req, transcript) {
    const ignoreWordsArr = _.get(req, '_settings.CONNECT_IGNORE_WORDS', "").split(',');
    if (ignoreWordsArr.length === 0 || !isConnectClient(req)) {
        return false;
    }
    const wordsInTranscript = transcript.split(' ');
    let trs = "";
    const wordCount = wordsInTranscript.length;
    for (let i = 0; i < wordCount; i++) {
        if (!ignoreWordsArr.includes(wordsInTranscript[i])) {
            if (trs.length > 0) trs += ' ';
            trs += wordsInTranscript[i];
        }
    }
    if (trs.trim().length === 0) {
        return true;
    } else {
        return false;
    }
}

function parseLexV1Event(event) {
    let out = {
        _type: "LEX",
        _lexVersion: "V1",
        _userId: _.get(event, "userId", "Unknown Lex User"),
        intentname: _.get(event, 'sessionState.intent.name'),
        question: _.get(event, 'inputTranscript').trim(),
        session: _.mapValues(
            _.get(event, 'sessionAttributes', {}),
            x => {
                try {
                    return JSON.parse(x)
                } catch (e) {
                    return x
                }
            }
        ),
        channel: _.get(event, "requestAttributes.'x-amz-lex:channel-type'")
    }
    
    //check if we pass in a qnabotUserId as a session attribute, if so, use it, else default
    out._userId = _.get(event,"sessionState.sessionAttributes.qnabotUserId", out._userId);
    qnabot.log("QnaBot User Id: " + out._userId);

    return out;
}

function parseLexV2Event(event) {
    let out = {
        _type: "LEX",
        _lexVersion: "V2",
        _userId: _.get(event, "sessionId", "Unknown Lex User"),
        intentname: _.get(event, 'sessionState.intent.name'),
        question: _.get(event, 'inputTranscript'),
        session: _.mapValues(
            _.get(event.sessionState, 'sessionAttributes', {}),
            x => {
                try {
                    return JSON.parse(x)
                } catch (e) {
                    return x
                }
            }
        ),
        channel: _.get(event, "requestAttributes.'x-amz-lex:channel-type'")
    }
    // If voice, set userPreferredLocale from Lex locale in request (Voice input/output language should be aligned to bot locale)
    const mode = _.get(event,"inputMode") ;
    if (mode == "Speech") {
        const lex_locale = _.get(event,'bot.localeId').split("_")[0];
        _.set(out,"session.qnabotcontext.userPreferredLocale", lex_locale);
        qnabot.log("LexV2 in voice mode - Set userPreferredLocale from lex V2 bot locale:", out.session.qnabotcontext.userPreferredLocale);
    } 
    
    //check if we pass in a qnabotUserId as a session attribute, if so, use it, else default
    out._userId = _.get(event,"sessionState.sessionAttributes.qnabotUserId", out._userId);
    qnabot.log("QnaBot User Id: " + out._userId);

    return out;
}

exports.parse=async function(req){
    var event = req._event;
    if (event.inputTranscript === undefined || event.inputTranscript === "") {
        // trap invalid input from Lex and and return an error if there is no inputTranscript.
        throw new Error("Error - inputTranscript string is empty.");
    } else if (trapIgnoreWords(req, event.inputTranscript)) {
        throw new Error(`Error - inputTranscript contains only words specified in setting CONNECT_IGNORE_WORDS: "${event.inputTranscript}"`);
    } else {
        var out;
        if ( ! _.get(event,"sessionId")) {
            out = parseLexV1Event(event);
        } else {
            out = parseLexV2Event(event);
        }
        return out;
    }
}

function filterButtons(response) {
    qnabot.log("Before filterButtons " + JSON.stringify(response))

    var filteredButtons = _.get(response.card,"buttons",[]);
    if (filteredButtons) {
        for (var i = filteredButtons.length - 1; i >= 0; --i) {
            if (!(filteredButtons[i].text && filteredButtons[i].value)){
                filteredButtons.splice(i,1);
            }
        }
        _.set(response.card,"buttons",filteredButtons) ;
    }
    qnabot.log("Response from filterButtons " + JSON.stringify(response))
    return response;
}

// ASSEMBLE FUNCTIONS

function slackifyResponse(response) {
    // Special handling for Slack responses
    // Markdown conversion, and convert string to utf8 encoding for unicode support
    if (_.get(response,"result.alt.markdown")) {
        let md = response.result.alt.markdown;
        qnabot.log("Converting markdown response to Slack format.");
        qnabot.log("Original markdown: ", JSON.stringify(md));

        md = md.replace(/<\/?span[^>]*>/g,"");  // remove any span tags (eg no-translate tags)
        md = md.replace(/<\/?br *\/?>/g,"\n"); // replace br with \n

        md = slackifyMarkdown(md);

        //decode URIs in markdown -- slackify-markdown encodes URI. If presented with an encoded URI, slackify-markdown is double encoding URIs
        md = decodeURI (md); 

        response.message = md ;
        qnabot.log("Converted markdown: ", JSON.stringify(md));
    } 
    qnabot.log("Converting Slack message javascript string to utf8 (for multi-byte compatibility).");
    return response;
}

function isCard(card){
    return _.get(card,"send")
}

function buildResponseCardV1(response) {
    let responseCardV1 = null;
    if (isCard(response.card) && (_.get(response.card,"imageUrl","").trim() || (_.get(response.card,"buttons",[]).length > 0))) {
        responseCardV1 = {
            version:"1",
            contentType:"application/vnd.amazonaws.card.generic",
            genericAttachments:[_.pickBy({
                title:_.get(response,"card.title","Title"),
                subTitle:_.get(response.card,'subTitle'),
                imageUrl:_.get(response.card,"imageUrl"),
                buttons:_.get(response.card,"buttons")
            })]
        };
    }
    return responseCardV1;
}

function buildImageResponseCardV2(response) {
    let imageResponseCardV2 = null;
    if (isCard(response.card) && (_.get(response.card,"imageUrl","").trim() || (_.get(response.card,"buttons",[]).length > 0))) {
        imageResponseCardV2 = {
            title:_.get(response,"card.title","Title"),
            subTitle:_.get(response.card,'subTitle'),
            imageUrl:_.get(response.card,"imageUrl"),
            buttons: _.get(response.card,"buttons")
        };
    }
    return imageResponseCardV2;
}

function copyResponseCardtoSessionAttribute(response) {
    let responseCardV1 = buildResponseCardV1(response);
    if (responseCardV1) {
        // copy Lex v1 response card to appContext session attribute used by lex-web-ui
        //  - allows repsonse card display even when using postContent (voice) with Lex (not otherwise supported by Lex)
        //  - allows Lex limit of 5 buttons to be exceeded when using lex-web-ui
        let tmp;
        try {
            tmp=JSON.parse(_.get(response,"session.appContext","{}"));
        } catch(e) {
            tmp=_.get(response,"session.appContext","{}");
        }
        tmp.responseCard=responseCardV1;
        response.session.appContext=JSON.stringify(tmp);
    }
    return response;
}

function limitLexButtonCount(response) {
    // Lex has limit of max 5 buttons in the responsecard.. if we have more than 5, use the first 5 only.
    // note when using lex-web-ui, this limitation is circumvented by use of the appContext session attribute above.
    let buttons = _.get(response.card,"buttons",[]) ;
    if (buttons && buttons.length > 5) {
        qnabot.log("WARNING: Truncating button list to contain only first 5 buttons to adhere to Lex limits.");
        _.set(response.card,"buttons",buttons.slice(0,5));
    }
    return response;
}

function limitLexDisplayTextLength(response) {
    // Lex has limit of max 5 buttons in the responsecard.. if we have more than 5, use the first 5 only.
    // note when using lex-web-ui, this limitation is circumvented by use of the appContext session attribute above.
    let buttons = _.get(response.card,"buttons",[]) ;
    for(let i=0;i<buttons.length;i++){
        response.card.buttons[i].text = response.card.buttons[i].text.slice(0,50)
        response.card.buttons[i].value = response.card.buttons[i].value.slice(0,50)
    }
    return response;
}

function assembleLexV1Response(response) {
    let out={
        sessionAttributes:_.get(response,'session',{}),
        dialogAction:_.pickBy({
            type:"Close",
            fulfillmentState:"Fulfilled",
            message:{
                contentType:response.type,
                content:response.message
            },
            responseCard: buildResponseCardV1(response)
        })
    };
    return out;
}

function assembleLexV2Response(response) {
    let out={
        "sessionState": {
            sessionAttributes:_.get(response,'session',{}),
            dialogAction:{
                type:"Close"
            },
            "intent": {
                name: response.intentname,
                state:"Fulfilled"
            }
        },
        "messages": [
            {
                "contentType": response.type,
                "content": response.message,
            }
        ]
    } ;
    let imageResponseCardV2 = buildImageResponseCardV2(response) ;
    if (imageResponseCardV2) {
        out.messages[1] = {
            "contentType": "ImageResponseCard",
            "imageResponseCard": imageResponseCardV2            
        };
    }
    return out;
}
    
exports.assemble=function(request,response){
    if (request._clientType === "LEX.Slack.Text") {
        response = slackifyResponse(response);
    }
    qnabot.log("filterButtons")
    response = filterButtons(response);
    qnabot.log("copyResponseCardToSessionAttributes")
    response = copyResponseCardtoSessionAttribute(response);
    qnabot.log("limitLexButtonCounts")
    response = limitLexButtonCount(response);
    qnabot.log("limitLexDisplayTextLength")
    response = limitLexDisplayTextLength(response)
    let out;
    if (request._lexVersion === "V1") {
        out= assembleLexV1Response(response);        
    } else {
        out= assembleLexV2Response(response);
    }
    qnabot.log("Lex response:",JSON.stringify(out,null,2))
    return out
}


