<template lang='pug'>
  v-container(grid-list-md)
    v-layout(column )
      v-flex
        v-card
          v-card-title 
            h3 Connect Instructions
          v-card-text(class="pa-0")
            v-stepper(v-model="stepNumber" class="elevation-0")
              v-stepper-header
                template(v-for="(step,index) in steps")
                  v-divider(v-if='index>0')
                  v-stepper-step(
                    :key="index"
                    :step="index+1"
                    :complete="stepNumber>index") {{step.title}}
                      small(v-if="step.optional") optional
              v-stepper-items
                v-stepper-content(
                  v-for="(step,index) in steps"
                  :key="index"
                  :step="index+1")
                  v-card
                    v-container
                      v-layout(row)
                        v-flex(xs1)
                          v-btn(
                            @click="stepNumber--" v-if="index>0" 
                            style="height:100%"
                            left) 
                            v-icon keyboard_arrow_left
                        v-flex(xs10)
                          v-container
                            v-layout(column)
                              v-flex(xs12)
                                v-card-text
                                  .headline.text-xs-center {{step.title}}
                                  span(v-html="step.text")
                                v-card-actions
                                  v-btn(v-for="(y,x) in step.buttons"
                                    :id="y.id"
                                    :key="x"
                                    :loading="y.loading"
                                    @click="copy(y)") {{y.text}}



                              v-flex(xs12)
                                img(
                                  :src="step.image"
                                  style="max-width:75%;display:block;margin:auto;"
                                  contain
                                  v-if="step.image"
                                )
                        v-flex(xs1)
                          v-btn(
                            @click="stepNumber++" v-if="index+1<steps.length"
                            style="height:100%"
                            right) 
                            v-icon keyboard_arrow_right
</template>

<script>
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

var Vuex=require('vuex')
var Promise=require('bluebird')
var markdown=require('marked')
var saveAs=require('file-saver').saveAs
var renderer=new markdown.Renderer()
var axios=require('axios')

renderer.link=function(href,title,text){
  return `<a href="${href}" title="${title}" target="_blank">${text}</a>` 
}
renderer.table=function(header,body){
  return `<table class="pure-table"><thead>${header}</thead><tbody>${body}</tbody></table>`
}

var handlebars=require('handlebars')
var clipboard=require('clipboard')
var _=require('lodash')
const { stringify }=require('querystring')

module.exports={
  data:function(){
    var self=this
    return {
      visible:false,
      stepNumber:1,
      schema:new clipboard('#Schema',{
        text:function(){
          return JSON.stringify(self.$store.state.bot.connect,null,2)
        }
      }),
      arn:new clipboard('#LambdaArn',{
        text:function(){
          return self.$store.state.bot.lambdaArn
        }
      }),
      stepsRaw:require('./steps.js')
    }
  },
  components:{
  },
  computed:Object.assign(
    Vuex.mapState([
        'bot'
    ]),
    {
    steps:function(){
      var self=this
      return _.map(this.stepsRaw,function(x){ 
        var y=Object.assign({},x)
        if(x.text){
          var temp=handlebars.compile(x.text)
          y.text=markdown(temp(self.$store.state.bot),{renderer})
        }
        return y
      })
    }
    }
  ),
  updated: function () {
      var self = this;
      this.$nextTick(function () {
        
            const downloadBlobAsFile = (function closure_shell() {
            const a = document.createElement("a");
            return function downloadBlobAsFile(blob, filename) {
                const object_URL = URL.createObjectURL(blob);
                a.href = object_URL;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(object_URL);
            };
          })();

          var links = document.links;

          for (var i = 0, linksLength = links.length; i < linksLength; i++) {
            if (links[i].hostname != window.location.hostname) {
              links[i].target = '_blank';
            } 
          }
          var button = document.getElementById("DownloadContactFlow");
          if(button)
          {
            button.onclick = function()
            {
              var result = self.$store.dispatch('api/getContactFlow').then((result) => {
              downloadBlobAsFile(new Blob(
                  [JSON.stringify(result.CallFlow)],
                  {type: "text/json"}
              ), result.FileName);
              })

            }
          }

    
          function poll(url){
            console.log(url)
            return self.$store.dispatch('api/getImport',{href: url})
            .then(function(result){

              if(result.status==="InProgress"){
                setTimeout(()=>poll(url),100)
              }
              else
              {
                return self.$store.dispatch('data/build')
                .then(function(){
                  btnImportQuestions.disabled = false;
                  btnImportQuestions.style.opacity = "1"
                  ImportQuestionsStatus.innerHTML = "Complete";

                  btnImportQuestions.innerHTML = "Import Sample Questions and Answers";
 
                }).then( result => {})
                .catch(e => 
                  ImportQuestionsStatus.innerHTML = "Error Rebuilding LexBot. Please return to the Content Designer, correct the errors and REBUILD LEXBOT </br>" +
                  "LexBot Rebuild Error " + e
                 )

              }
            })
          }

          //Attach function to ImportQuestions button
          var btnImportQuestions = document.getElementById("ImportQuestions");
          var ImportQuestionsStatus = document.getElementById("ImportQuestionsStatus");

          
          if(btnImportQuestions){
                  btnImportQuestions.onclick = function() {
                    btnImportQuestions.disabled = true;
                    btnImportQuestions.style.opacity = "0.5"
                    document.getElementById("stsLabel").innerHTML = "Status:"
                    ImportQuestionsStatus.innerHTML = "Importing Questions (Step 1)..."
                    self.$store.dispatch('api/getContactFlow')
                    .then(result => {
                      self.contactFlow = result;
                      ImportQuestionsStatus.innerHTML = "Importing Questions (Step 2)..."

                      return self.$store.dispatch("api/listExamples")
                    })
                    .then(result =>  {
                        ImportQuestionsStatus.innerHTML = "Importing Questions (Step 3)..."
                        let  exampleUrl = result.filter(example => self.contactFlow.QnaFile == example.document.href.split("/").slice(-1)[0] )[0];
                        return self.$store.dispatch('api/getImport',{href: exampleUrl.document.href})
                    })
                    .then(result =>  {
                        ImportQuestionsStatus.innerHTML = "Importing Questions (Step 4)..."


                        return self.$store.dispatch('api/startImport',{
                        qa:result.qna,
                        name:self.contactFlow.QnaFile
                      
                      })
                    })
                    .then(results => {
                        ImportQuestionsStatus.innerHTML = "Importing Questions (Step 5)..."
                        return self.$store.dispatch('api/waitForImport',{id: self.contactFlow.QnaFile })
                    })
                    .then(res =>  {
                      console.log(JSON.stringify(res))
                      ImportQuestionsStatus.innerHTML = "Rebuilding Lex Bot."
                      self.pollUrl = res.href;
                      return poll(self.pollUrl)
                    })
                    .then()

                    }
              }
          
          

          var spanBot = document.getElementById("spnBotname")
          if(spanBot)
          {
            self.$store.dispatch("api/botinfo").then((result) => spanBot.innerHTML = result.lexV2botname );
          }

        })
  },

   created:function(){
     this.$store.dispatch('data/botinfo').catch(()=>null) 
   },
    methods:{
      copy:function(btn){
        btn.loading=true
        setTimeout(()=>btn.loading=false,1000)
      }
    } 

  } 


</script>
