var Promise=require('bluebird')
var aws=require('aws-sdk')
aws.config.region=process.env.AWS_REGION
var axios=require('axios')
var sign=require('aws4').sign
var Url=require('url')
const qnabot = require("qnabot/logging")


module.exports=function(opts){
    
    const url=Url.parse(opts.url)
    const request={
        host:url.hostname,
        method:opts.method.toUpperCase(),
        url:url.href,
        path:url.path,
        headers:opts.headers || {}
    }
    request.headers['Host']=request.host;
    if(opts.body){
        if(Array.isArray(opts.body)){
            opts.body=opts.body.map(JSON.stringify).join('\n')+'\n'
            request.headers['content-type']='application/x-ndjson'
        }else if(typeof opts.body === "string"){
            opts.body=opts.body  
            request.headers['content-type']='application/json'
        }else{
            opts.body = JSON.stringify(opts.body)
            request.headers['content-type']='application/json'
        }
        request.body=opts.body
        request.data=opts.body
    }
    qnabot.log("request",JSON.stringify(request,null,2))

    return new Promise(function(res,rej){
        function next(count){
            if(count>0){
                qnabot.log("Tries left:"+count)
                var credentials=aws.config.credentials
                var signed=sign(request,credentials)        
                Promise.resolve(axios(signed))
                .then(res)
                .catch(error=>{
                    if(error.code==="ECONNABORTED"){
                        setTimeout(()=>next(--count),1000)
                    }else{
                        rej(error)
                    }
                })
            }else{
                rej("timeout")
            }
        }
        next(10)
    })
    .tap(x=>qnabot.log(x.status))
    .get('data')
}
