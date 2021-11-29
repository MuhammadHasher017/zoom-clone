import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { io } from 'socket.io-client';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  clientMessageResponse,
  CommonService,
  iceConfiguration,
} from '../../service/common.service';

@Component({
  selector: 'app-meeting',
  templateUrl: './meeting.component.html',
  styleUrls: ['./meeting.component.css'],
})
export class MeetingComponent implements OnInit, OnDestroy {
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private matSnackBar: MatSnackBar,
    private breakPoint$: BreakpointObserver,
    private commonSrv: CommonService
  ) {}
  meetingId = '';
  socket;
  room = '';
  myOwnMessage;
  localPeerConnection;
  remoteMediaStream = new MediaStream();
  @ViewChild('localVideo', { static: true }) localVideoHtmlElement: ElementRef;
  @ViewChild('remoteVideo', { static: true })
  remoteVideoHtmlElement: ElementRef;
  isConnected = false;
  fxAlignment;
  width;
  height;
  status = 'Meeting ID';

  ngOnInit(): void {
    this.socket = this.commonSrv.localSocketIO();
    this.breakPointObserver();
    this.start();
  }

  start() {
    this.setUpLocalVideo();
    this.initiateWebRtc();
    console.log('already,start function fired.');

    this.meetingId = this.route.snapshot.params.meetingId;
    if (this.meetingId) {
      this.room = this.meetingId;
      //join otherwise set it.
      this.socket.emit('join-room', this.meetingId);
      this.socket.on('join-room', (flag) => {
        if (flag === 'true') {
          let messageModel: clientMessageResponse = {
            room: this.meetingId,
            message: 'USERS CONNECTED',
          };
          this.socket.emit('hello-message', messageModel);
        } else {
          this.router.navigate(['/zoom']);
        }
      });
    } else {
      console.log('setting rooom');
      this.socket.emit('create-room', '');
      this.socket.on('create-room', (room) => {
        this.room = room;
      });
    }

    this.socket.on('hello-message', (body) => {
      if (body === 'USERS CONNECTED') {
        console.log('CONNECTED,NOW MAKING VIDEO CONNECTION');
        this.makeVideoConnection();
      }
    });

    //info :
    //1 -> user 2 is creating answer
    //2-> user 1 is accepting
    //3 -> setting ice candidates.

    this.socket.on('send-message', (body) => {
      if (!this.myOwnMessage) {
        //setting user 2 remote description from user1
        if (body?.info === '1') {
          console.log('setting offer for user 2 and creating answer');
          this.localPeerConnection
            .setRemoteDescription(new RTCSessionDescription(body.message))
            .then(() => {
              this.localPeerConnection.createAnswer().then((answer) => {
                this.localPeerConnection
                  .setLocalDescription(answer)
                  .then(() => {
                    let messageModel: clientMessageResponse = {
                      room: this.room,
                      message: answer,
                      info: '2',
                    };

                    this.socket.emit('send-message', messageModel);
                    this.myOwnMessage = true;
                  });
              });
              this.isConnected = true;
            });
        }

        //setting user 1 remote description from user2
        if (body?.info === '2') {
          console.log('setting answer for user 1');
          this.localPeerConnection.setRemoteDescription(
            new RTCSessionDescription(body.message)
          );
          console.log('all set');
          this.isConnected = true;
        }

        if (body?.info === '3') {
          //it is ice candidate message indeed.
          if (body.message) {
            this.localPeerConnection.addIceCandidate(body.message);
            console.log('Ice candidate added.');
          }
        }
      } else {
        this.myOwnMessage = false;
      }
    });
  }

  makeVideoConnection() {
    console.log('setting local offer and sending');
    this.localPeerConnection.createOffer().then((offer) => {
      this.localPeerConnection.setLocalDescription(offer).then(() => {
        let messageModel: clientMessageResponse = {
          room: this.room,
          message: offer,
          info: '1',
        };

        this.socket.emit('send-message', messageModel);
        this.myOwnMessage = true;
      });
    });
  }

  initiateWebRtc() {
    this.localPeerConnection = new RTCPeerConnection(iceConfiguration);
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((localMediaStream) => {
        this.remoteVideoHtmlElement.nativeElement.srcObject =
          this.remoteMediaStream;
        this.localPeerConnection.addStream(localMediaStream);
      });
    this.registerListener();
  }

  closeVideoConnection() {
    this.status = 'Meeting has Ended!';
    this.room = '';
    this.localPeerConnection.close();
    this.isConnected = false;
    this.socket.emit('force-disconnect', '');
  }

  registerListener() {
    //this will run when we will get remote media stream after setup successfully
    console.log('running listener');
    this.localPeerConnection.ontrack = (event) => {
      console.log('adding track');
      this.remoteMediaStream = event.streams[0];
      this.remoteVideoHtmlElement.nativeElement.srcObject =
        this.remoteMediaStream;
    };

    //this will run when local set up desc is set,so ice candidate should be sent to others via signalling
    this.localPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        let messageModel = {
          room: this.room,
          message: event.candidate,
          info: '3',
        };
        this.socket.emit('send-message', messageModel);
        this.myOwnMessage = true;
      }
    };

    this.localPeerConnection.onconnectionstatechange = (event) => {
      if (this.localPeerConnection.connectionState === 'disconnected') {
        this.matSnackBar.open(
          'User has Disconnected. Press Find For New User',
          'X',
          {
            verticalPosition: 'top',
            horizontalPosition: 'center',
            duration: 4000,
            panelClass: ['snackbar-class'],
          }
        );
        this.closeVideoConnection();
      }
    };
  }

  setUpLocalVideo() {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((localMediaStream) => {
        this.localVideoHtmlElement.nativeElement.srcObject = localMediaStream;
      });
  }

  ngOnDestroy() {
    this.socket?.emit('force-disconnect', '');
  }

  copyMeetingId(inputElement) {
    inputElement.select();
    document.execCommand('copy');
    inputElement.setSelectionRange(0, 0);
  }

  breakPointObserver() {
    this.breakPoint$.observe('(max-width:768px)').subscribe((data) => {
      if (data.matches) {
        this.fxAlignment = 'column';
        this.width = '330';
        this.height = '250';
      } else {
        this.fxAlignment = 'row';
        this.width = '600';
        this.height = '450';
      }
    });
  }
}
